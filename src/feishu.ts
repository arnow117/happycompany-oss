import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';
import { StreamingCard } from './streaming-card.js';
import type { ChannelAdapter, StreamingHandle, CardAction, DownloadedFile } from './channel.js';
import type { NormalizedMessage, BotConfig, FileAttachment } from './types.js';
import {
  feishuMessageEventSchema,
  feishuCardActionSchema,
  type FeishuMessageEvent,
  type FeishuCardAction,
} from './schemas.js';
import { extractMessageContent } from './feishu-parse.js';
import { optimizeMarkdownStyle } from './feishu-markdown-style.js';
import { buildAgentReplyCard } from './feishu-cards/builder.js';

/**
 * FeishuChannel: implements ChannelAdapter for the Feishu (Lark) platform.
 *
 * Adapts from bot-swarm's FeishuBot with these key changes:
 * - Implements ChannelAdapter interface (happycompany contract)
 * - Constructor takes BotConfig instead of individual appId/appSecret
 * - onMessage produces NormalizedMessage (not IncomingMessage)
 * - No injectSynthetic / topology logic (removed from happycompany)
 * - No onAfterSend fan-out hook (not needed without fan-out)
 */
export class FeishuChannel implements ChannelAdapter {
  readonly name = 'feishu';

  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private eventDispatcher: lark.EventDispatcher | null = null;
  private botOpenId = '';
  private config: BotConfig;

  private messageHandlers: Array<(msg: NormalizedMessage) => void> = [];
  private cardActionHandlers: Array<(action: CardAction) => void> = [];

  // File key cache: messageId -> Array<{ fileKey, msgType, fileName }>
  private fileKeyEntries = new Map<string, Array<{ fileKey: string; msgType: string; fileName: string }>>();
  private static readonly MAX_FILE_CACHE = 2000;
  // Ack reaction tracking: chatId -> "messageId:reactionId"
  private ackReactions = new Map<string, string>();
  // Last message ID per chat for reply context
  private lastMessageIdByChat = new Map<string, string>();

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new lark.Client({
      appId: config.credentials?.appId ?? '',
      appSecret: config.credentials?.appSecret ?? '',
      appType: lark.AppType.SelfBuild,
    });
  }

  async start(): Promise<void> {
    this.botOpenId = await this.fetchBotOpenId();

    this.eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleMessageEvent(data);
      },
      'card.action.trigger': async (data: unknown) => {
        await this.handleCardAction(data);
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.config.credentials?.appId ?? '',
      appSecret: this.config.credentials?.appSecret ?? '',
      loggerLevel: lark.LoggerLevel.error,
    });

    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    logger.info(
      { bot: this.config.name, openId: this.botOpenId },
      'Feishu channel WebSocket connected',
    );
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      try {
        await this.wsClient.close();
      } catch (err) {
        logger.warn({ err, bot: this.config.name }, 'Error closing wsClient');
      }
      this.wsClient = null;
    }
  }

  onMessage(handler: (msg: NormalizedMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onCardAction(handler: (action: CardAction) => void): () => void {
    this.cardActionHandlers.push(handler);
    return () => {
      this.cardActionHandlers = this.cardActionHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Send a message to a Feishu chat with 3-level fallback:
   * Level 1: Interactive card (Schema 2.0) via buildAgentReplyCard
   * Level 2: Post+Markdown fallback
   * Level 3: Plain text fallback
   */
  async send(chatId: string, text: string): Promise<void> {
    try {
      // Detect pre-built interactive card JSON — send directly
      if (text.startsWith('{"type":"interactive"')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === 'interactive' && parsed.card) {
            await this.sendToFeishu(chatId, 'interactive', text);
            this.clearAckReaction(chatId);
            return;
          }
        } catch {
          // Not valid card JSON, fall through
        }
      }

      // Count tables — Feishu cards have a table limit
      const tableCount = (text.match(/^\|[\s:-]+\|/gm) || []).length;
      const usePostMd = tableCount > 5;

      if (usePostMd) {
        const postContent = buildPostMdFallback(text);
        await this.sendToFeishu(chatId, 'post', postContent);
      } else {
        const card = buildAgentReplyCard({ status: 'done', text });
        const content = JSON.stringify(card);
        try {
          await this.sendToFeishu(chatId, 'interactive', content);
        } catch (err) {
          logger.warn(
            { err, chatId },
            'Feishu interactive send failed, fallback to post+md',
          );
          await this.sendToFeishu(chatId, 'post', buildPostMdFallback(text));
        }
      }
      logger.debug({ chatId }, 'Sent Feishu card message');
      this.clearAckReaction(chatId);
    } catch (err) {
      logger.error({ err, chatId }, 'Failed to send Feishu card message');
      this.clearAckReaction(chatId);
    }
  }

  async sendImage(chatId: string, imageBuffer: Buffer, mimeType: string, caption?: string): Promise<boolean> {
    try {
      const uploadResult = (await this.client.im.v1.image.create({
        data: {
          image_type: 'message',
          image: imageBuffer,
        },
      })) as { image_key?: string; data?: { image_key?: string } } | null | undefined;

      const imageKey = uploadResult?.image_key ?? uploadResult?.data?.image_key;
      if (!imageKey) {
        logger.error({ chatId }, 'Feishu image upload failed: no image_key returned');
        return false;
      }

      await this.sendToFeishu(chatId, 'image', JSON.stringify({ image_key: imageKey }));

      if (caption) {
        await this.sendToFeishu(chatId, 'text', JSON.stringify({ text: caption }));
      }

      logger.info({ chatId, imageKey, mimeType, size: imageBuffer.length }, 'Feishu image sent');
      return true;
    } catch (err) {
      logger.error({ err, chatId, mimeType }, 'Failed to send Feishu image');
      return false;
    }
  }

  async sendFile(chatId: string, filePath: string, fileName: string): Promise<boolean> {
    try {
      const buffer = await fs.promises.readFile(filePath);

      const MAX_FILE_SIZE = 30 * 1024 * 1024;
      if (buffer.length > MAX_FILE_SIZE) {
        logger.warn(
          { chatId, size: buffer.length },
          `File exceeds 30MB limit (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`,
        );
        return false;
      }

      const ext = path.extname(fileName);
      const fileType = getFeishuFileType(ext);

      const uploadResult = (await this.client.im.v1.file.create({
        data: {
          file_type: fileType,
          file_name: fileName,
          file: buffer,
        },
      })) as { file_key?: string; data?: { file_key?: string } } | null | undefined;

      const fileKey = uploadResult?.file_key ?? uploadResult?.data?.file_key;
      if (!fileKey) {
        logger.error({ chatId }, 'Feishu file upload failed: no file_key returned');
        return false;
      }

      const msgType = fileType === 'mp4' ? 'media' : fileType === 'opus' ? 'audio' : 'file';
      await this.sendToFeishu(chatId, msgType, JSON.stringify({ file_key: fileKey }));

      logger.info({ chatId, fileName, fileSize: buffer.length }, 'File sent to Feishu');
      return true;
    } catch (err) {
      logger.error({ err, chatId, filePath }, 'Failed to send file to Feishu');
      return false;
    }
  }

  clearAckReaction(chatId: string): void {
    const stored = this.ackReactions.get(chatId);
    if (stored) {
      const [msgId, reactionId] = stored.split(':');
      this.removeReaction(msgId!, reactionId!).catch(() => {});
      this.ackReactions.delete(chatId);
    }
  }

  /**
   * Create a streaming card for an agent reply. Returns a StreamingHandle
   * that wraps the underlying StreamingCard.
   */
  sendStreaming(chatId: string): StreamingHandle {
    const card = new StreamingCard(this.client, this.config.displayName);

    let started = false;
    let startPromise: Promise<void> | null = null;

    // Lazily start the card on first interaction
    const ensureStarted = (): Promise<void> => {
      if (!started) {
        started = true;
        startPromise = card.start(chatId).then((msgId) => {
          logger.info(
            { bot: this.config.name, chatId, messageId: msgId },
            'Feishu streaming card started',
          );
        });
      }
      return startPromise!;
    };

    return {
      update: (text: string) => {
        ensureStarted().then(() => card.update(text));
      },
      finalize: (text: string) => {
        ensureStarted().then(() => card.finalize(text));
      },
      updateToolStatus: (info: {
        toolName: string;
        status: 'running' | 'complete' | 'error';
        elapsedMs?: number;
      }) => {
        const statusEmoji = info.status === 'running' ? '⏳' : info.status === 'complete' ? '✅' : '❌';
        const elapsed = info.elapsedMs ? ` (${Math.round(info.elapsedMs / 1000)}s)` : '';
        ensureStarted().then(() =>
          card.updateToolStatus(`${statusEmoji} ${info.toolName}${elapsed}`),
        );
      },
      abort: () => {
        ensureStarted().then(() => card.finalize(''));
      },
      delete: () => {
        if (started) {
          card.deleteMessage();
        }
      },
    };
  }

  /**
   * Add an emoji reaction to a Feishu message.
   * Errors are swallowed at debug level; a wrong emoji_type should never
   * block the main message loop.
   */
  async react(messageId: string, emoji: string): Promise<void> {
    try {
      await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emoji } },
      });
      logger.info(
        { bot: this.config.name, messageId, emoji },
        'Reaction added',
      );
    } catch (err) {
      const e = err as { response?: { data?: { code?: number; msg?: string } } };
      const code = e?.response?.data?.code;
      const msg = e?.response?.data?.msg;
      logger.debug(
        { bot: this.config.name, messageId, emoji, code, msg },
        'Reaction add failed (non-critical, likely invalid emoji_type)',
      );
    }
  }

  /**
   * Download a file from Feishu using the messageResource API.
   *
   * Uses `client.im.messageResource.get({ path: { message_id, file_key }, params: { type } })`
   * to retrieve the resource stream, writes to a temp file, and extracts text content
   * when possible.
   */
  async downloadFile(fileRef: {
    messageId: string;
    fileName: string;
  }): Promise<DownloadedFile> {
    // Look up file entry by messageId, prefer matching fileName
    const entries = this.fileKeyEntries.get(fileRef.messageId);
    const entry = entries?.find((e) => e.fileName === fileRef.fileName) ?? entries?.[0];

    if (!entry) {
      throw new Error(
        `No file_key found for message ${fileRef.messageId}. ` +
        `The message must contain a file or image attachment.`,
      );
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'feishu-dl-'));
    const ext = path.extname(fileRef.fileName) || '.bin';
    const localPath = path.join(tmpDir, fileRef.fileName);

    try {
      const resource = await this.client.im.messageResource.get({
        path: {
          message_id: fileRef.messageId,
          file_key: entry.fileKey,
        },
        params: {
          type: entry.msgType,
        },
      });

      await resource.writeFile(localPath);

      let textContent: string | undefined;
      const stat = await fs.promises.stat(localPath);

      if (stat.size === 0) {
        throw new Error(`Downloaded file is empty: ${fileRef.fileName}`);
      }

      // Extract text content for text-based files
      const buffer = await fs.promises.readFile(localPath);
      const lowerName = fileRef.fileName.toLowerCase();
      const textExtensions = [
        '.txt', '.csv', '.json', '.md', '.log',
        '.ts', '.js', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
        '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.sql',
      ];
      const isText = textExtensions.some((e) => lowerName.endsWith(e));
      if (isText) {
        textContent = buffer.toString('utf-8');
      } else {
        textContent = `[binary file: ${fileRef.fileName}]`;
      }

      // Generate base64 for images under 5MB
      let base64: string | undefined;
      const isImage = entry.msgType === 'image';
      if (isImage && buffer.length <= 5 * 1024 * 1024) {
        base64 = buffer.toString('base64');
      }

      const contentType = guessMimeType(ext, entry.msgType);

      return {
        type: isImage ? 'image' : 'file',
        name: fileRef.fileName,
        localPath,
        mimeType: contentType,
        textContent,
        base64,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, messageId: fileRef.messageId, fileName: fileRef.fileName },
        'Feishu file download failed',
      );
      throw new Error(`Feishu file download failed for ${fileRef.fileName}: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchBotOpenId(): Promise<string> {
    try {
      const res = (await this.client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info/',
      })) as {
        bot?: { open_id?: string };
        data?: { bot?: { open_id?: string } };
      };
      const openId = res?.bot?.open_id ?? res?.data?.bot?.open_id ?? '';
      if (!openId) {
        throw new Error('bot.open_id missing from /open-apis/bot/v3/info/ response');
      }
      return openId;
    } catch (err) {
      logger.error({ err, bot: this.config.name }, 'Failed to fetch bot open_id');
      throw new Error(`Bot "${this.config.name}" open_id fetch failed: ${String(err)}`);
    }
  }

  private async sendToFeishu(chatId: string, msgType: string, content: string): Promise<void> {
    const target = parseFeishuRouteTarget(chatId);
    const receiveIdType = target.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const replyMsgId = target.rootMessageId || this.lastMessageIdByChat.get(target.chatId);

    if (replyMsgId) {
      await this.client.im.message.reply({
        path: { message_id: replyMsgId },
        data: {
          content,
          msg_type: msgType,
          ...(target.rootMessageId ? { reply_in_thread: true } : {}),
        },
      });
    } else {
      const resp = await this.client.im.v1.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: target.chatId,
          msg_type: msgType,
          content,
        },
      });
      const newMsgId = (resp.data as Record<string, unknown> | undefined)?.message_id;
      if (typeof newMsgId === 'string' && newMsgId) {
        this.lastMessageIdByChat.set(target.chatId, newMsgId);
      }
    }
  }

  private async addReaction(messageId: string, emojiType: string): Promise<string | null> {
    try {
      const res = (await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      })) as { data?: { reaction_id?: string } };
      return res.data?.reaction_id || null;
    } catch (err) {
      logger.debug({ err, messageId, emojiType }, 'Failed to add reaction');
      return null;
    }
  }

  private async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      await this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
    } catch (err) {
      logger.debug({ err, messageId, reactionId }, 'Failed to remove reaction');
    }
  }

  private async handleMessageEvent(data: unknown): Promise<void> {
    try {
      const evt = feishuMessageEventSchema.parse(data);

      const senderOpenId = evt.sender?.sender_id?.open_id ?? '';

      // Self-message filtering: drop messages sent by this bot itself
      if (senderOpenId === this.botOpenId) {
        logger.debug({ bot: this.config.name }, 'Dropped self-sent message');
        return;
      }

      const msgType = evt.message.message_type;
      const messageId = evt.message.message_id;
      const chatId = evt.message.chat_id;

      // Track last message ID per chat for reply context
      this.lastMessageIdByChat.set(chatId, messageId);

      // Use extractMessageContent for 16+ message types
      const content = typeof evt.message.content === 'string'
        ? evt.message.content
        : JSON.stringify(evt.message.content);
      const extracted = extractMessageContent(msgType, content);

      let textContent = extracted.text;
      let files: FileAttachment[] | undefined;

      // Cache file keys for downloadFile
      const entries = this.fileKeyEntries.get(messageId) ?? [];
      if (extracted.fileInfos) {
        for (const fi of extracted.fileInfos) {
          entries.push({ fileKey: fi.fileKey, msgType: 'file', fileName: fi.filename });
          files = files ?? [];
          files.push({ type: 'file', name: fi.filename, localPath: '' });
        }
      }
      if (extracted.imageKeys) {
        for (let i = 0; i < extracted.imageKeys.length; i++) {
          const imageKey = extracted.imageKeys[i];
          entries.push({ fileKey: imageKey, msgType: 'image', fileName: `image_${i}` });
          files = files ?? [];
          files.push({ type: 'image', name: `image_${i}`, localPath: '' });
        }
      }
      if (entries.length > 0) this.fileKeyEntries.set(messageId, entries);

      let replyTo: NormalizedMessage['replyTo'];
      const rootId = evt.message.root_id;
      if (rootId) {
        try {
          const parentText = await this.fetchParentMessage(rootId);
          if (parentText) {
            textContent = buildReplyContent(textContent, parentText);
            replyTo = { messageId: rootId, text: parentText };
          }
        } catch (err) {
          logger.warn({ rootId, err }, 'Failed to fetch parent message for reply');
        }
      }

      // Process mentions: replace mention keys with @name
      const mentions = evt.message.mentions;
      if (mentions && mentions.length > 0) {
        for (const mention of mentions) {
          const key = mention.key;
          const name = mention.name;
          if (key && name) {
            textContent = textContent.replace(key, `@${name}`);
          }
        }
      }

      const msg: NormalizedMessage = {
        id: messageId,
        chatId,
        text: textContent,
        source: 'user',
        channelId: 'feishu',
        fromBotName: undefined,
        fromUserId: senderOpenId || undefined,
        receivedAt: Date.now(),
        createTimeMs: evt.message.create_time ? Number(evt.message.create_time) * 1000 : undefined,
        threadId: evt.message.thread_id,
        rootId: evt.message.root_id,
        parentId: evt.message.parent_id,
        chatType: evt.message.chat_type as 'group' | 'p2p' | undefined,
        mentions: mentions?.map((m) => ({
          key: m.key,
          name: m.name,
          id: m.id ? { open_id: m.id.open_id } : undefined,
        })),
        files,
        replyTo,
      };

      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    } catch (err) {
      logger.error({ err, bot: this.config.name }, 'Error handling message event');
    }
  }

  private async fetchParentMessage(messageId: string): Promise<string | null> {
    try {
      const resp = await this.client.im.v1.message.get({
        path: { message_id: messageId },
      });
      const raw = resp.data as Record<string, unknown> | undefined;
      const items = raw?.items as Array<Record<string, unknown>> | undefined;
      const body = items?.[0]?.body as Record<string, unknown> | undefined;
      if (!body) return null;

      const rawContent = body.content;
      const msgType = body.message_type as string | undefined;

      if (typeof rawContent !== 'string') return null;
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;

      if (msgType === 'text') {
        const text = typeof parsed.text === 'string' ? parsed.text : '';
        return text.length > 500 ? text.slice(0, 500) + '...' : text;
      }
      if (msgType === 'file') {
        const fileName = typeof parsed.file_name === 'string' ? parsed.file_name : 'file';
        return `[quoted file: ${fileName}]`;
      }
      if (msgType === 'image') {
        return '[quoted picture]';
      }
      return null;
    } catch (err) {
      logger.debug({ messageId, err }, 'Parent message fetch failed');
      return null;
    }
  }

  private async handleCardAction(data: unknown): Promise<void> {
    try {
      const evt = feishuCardActionSchema.parse(data);
      const value = evt.action?.value ?? {};
      const actionStr = String(value.action ?? '');
      const messageId = evt.context?.open_message_id ?? '';
      const chatId = evt.context?.open_chat_id ?? '';

      if (!messageId || !chatId) {
        logger.debug(
          { bot: this.config.name },
          'Card action missing messageId or chatId, ignoring',
        );
        return;
      }

      logger.info(
        { bot: this.config.name, messageId, chatId, action: actionStr },
        'Card action received',
      );

      const cardAction: CardAction = {
        chatId,
        messageId,
        action: actionStr,
        value: Object.keys(value).length > 0 ? value : undefined,
      };

      for (const handler of this.cardActionHandlers) {
        handler(cardAction);
      }
    } catch (err) {
      logger.error({ err, bot: this.config.name }, 'Error handling card action');
    }
  }
}

/**
 * Parse a raw Feishu `im.message.receive_v1` event into a NormalizedMessage.
 * Extracted as a pure function for testability.
 */
export function parseFeishuMessageEvent(
  data: unknown,
  botOpenId: string,
): NormalizedMessage | null {
  const result = feishuMessageEventSchema.safeParse(data);
  if (!result.success) {
    return null;
  }
  const evt = result.data;

  const senderOpenId = evt.sender?.sender_id?.open_id ?? '';

  // Self-message filtering
  if (senderOpenId === botOpenId) {
    return null;
  }

  const msgType = evt.message.message_type;
  const content = typeof evt.message.content === 'string'
    ? evt.message.content
    : JSON.stringify(evt.message.content);
  const extracted = extractMessageContent(msgType, content);

  // Skip message types that produce no text and no attachments
  if (!extracted.text && !extracted.imageKeys?.length && !extracted.fileInfos?.length) {
    return null;
  }

  let files: FileAttachment[] | undefined;
  if (extracted.fileInfos) {
    files = extracted.fileInfos.map((fi) => ({ type: 'file', name: fi.filename, localPath: '' }));
  }
  if (extracted.imageKeys) {
    const imageFiles = extracted.imageKeys.map(() => ({ type: 'image' as const, name: 'image', localPath: '' }));
    files = files ? [...files, ...imageFiles] : imageFiles;
  }

  const mentions = evt.message.mentions;
  let textContent = extracted.text;
  if (mentions && mentions.length > 0) {
    for (const mention of mentions) {
      const key = mention.key;
      const name = mention.name;
      if (key && name) {
        textContent = textContent.replace(key, `@${name}`);
      }
    }
  }

  return {
    id: evt.message.message_id,
    chatId: evt.message.chat_id,
    text: textContent,
    source: 'user',
    channelId: 'feishu',
    fromBotName: undefined,
    fromUserId: senderOpenId || undefined,
    receivedAt: Date.now(),
    createTimeMs: evt.message.create_time ? Number(evt.message.create_time) * 1000 : undefined,
    threadId: evt.message.thread_id,
    rootId: evt.message.root_id,
    parentId: evt.message.parent_id,
    chatType: evt.message.chat_type as 'group' | 'p2p' | undefined,
    mentions: mentions?.map((m) => ({
      key: m.key,
      name: m.name,
      id: m.id ? { open_id: m.id.open_id } : undefined,
    })),
    files,
  };
}

/**
 * Build reply content with quoted parent text prepended.
 * Pure function — extracted for testability and reuse.
 */
export function buildReplyContent(userText: string, parentText: string): string {
  if (!parentText) return userText;
  const quoted = parentText.split('\n').map((line) => `> ${line}`).join('\n');
  return userText ? `${quoted}\n\n${userText}` : quoted;
}

/**
 * Guess MIME type from file extension and Feishu message type.
 */
function guessMimeType(ext: string, msgType: string): string {
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
  };
  if (mimeMap[ext]) return mimeMap[ext];
  if (msgType === 'image') return 'image/png';
  return 'application/octet-stream';
}

export interface FeishuRouteTarget {
  raw: string;
  chatId: string;
  threadId?: string;
  rootMessageId?: string;
}

export function parseFeishuRouteTarget(raw: string): FeishuRouteTarget {
  const [chatId, ...parts] = raw.split('#');
  let threadId: string | undefined;
  let rootMessageId: string | undefined;
  for (const part of parts) {
    if (part.startsWith('thread:')) {
      threadId = part.slice('thread:'.length);
    } else if (part.startsWith('root:')) {
      rootMessageId = part.slice('root:'.length);
    }
  }
  return { raw, chatId, threadId, rootMessageId };
}

function buildPostMdFallback(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: optimizeMarkdownStyle(text, 1) }]],
    },
  });
}

function getFeishuFileType(ext: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
  const map: Record<string, 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream'> = {
    '.pdf': 'pdf',
    '.doc': 'doc',
    '.docx': 'doc',
    '.xls': 'xls',
    '.xlsx': 'xls',
    '.ppt': 'ppt',
    '.pptx': 'ppt',
    '.mp4': 'mp4',
    '.opus': 'opus',
  };
  return map[ext.toLowerCase()] || 'stream';
}
