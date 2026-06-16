/**
 * DingTalkChannel: implements ChannelAdapter for the DingTalk platform.
 *
 * Extracted from happycompany's dingtalk.ts to fit the happycompany interface.
 * Features: token caching, WS streaming, dedup, text/picture/file handling,
 * reply detection, ack reaction, streaming cards, /clear command.
 */

import crypto from 'crypto';
import https from 'node:https';
import * as DingTalkStreamStub from './dingtalk-stream-stub.js';
import { logger } from './logger.js';
import { DedupCache } from './dedup.js';
import { DingTalkStreamingCard } from './dingtalk-card.js';
import type { DingTalkCardConfig } from './dingtalk-card.js';
import { extractRepliedMsg, type RepliedMsg } from './dingtalk-reply-parser.js';
import { extractFileText, downloadByCode } from './dingtalk-utils.js';
import { markdownToPlainText, splitTextChunks } from './im-utils.js';
import type {
  ChannelAdapter,
  StreamingHandle,
  CardAction,
  DownloadedFile,
} from './channel.js';
import type { NormalizedMessage, BotConfig, FileAttachment } from './types.js';
import { dingtalkRobotMessageSchema } from './schemas.js';
import type { DingTalkRobotMessage } from './schemas.js';

// -- Constants --

const DINGTALK_API_BASE = 'https://api.dingtalk.com';
const MAX_IMAGE_BASE64_SIZE = 5 * 1024 * 1024;
const DINGTALK_CHUNK_LIMIT = 4000;

// -- Types --

interface DingTalkAccessToken {
  token: string;
  expiresAt: number;
}

interface DingTalkDownstream {
  data: string;
  headers?: { messageId?: string; topic?: string };
}

interface DingTalkStreamClient {
  registerCallbackListener: (
    topic: string,
    cb: (downstream: DingTalkDownstream) => Promise<void>,
  ) => void;
  socketCallBackResponse: (messageId: string, response: unknown) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

interface DingTalkStreamSdk {
  DWClient: new (opts: {
    clientId: string;
    clientSecret: string;
    debug?: boolean;
    keepAlive?: boolean;
  }) => DingTalkStreamClient;
  TOPIC_ROBOT: string;
}

interface DingTalkChannelOptions {
  streamSdk?: DingTalkStreamSdk;
}

async function loadDingTalkStreamSdk(): Promise<DingTalkStreamSdk> {
  try {
    const sdk = await import('dingtalk-stream');
    logger.info({ sdkKeys: Object.keys(sdk).join(','), isStub: false }, 'DingTalk Stream SDK loaded');
    return sdk as DingTalkStreamSdk;
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
      throw err;
    }
    if (process.env.NODE_ENV === 'test' || process.env.DINGTALK_STREAM_ALLOW_STUB === '1') {
      return DingTalkStreamStub;
    }
    throw new Error(
      'DingTalk Stream SDK package "dingtalk-stream" is not installed. Install it before starting a real DingTalk bot.',
    );
  }
}

/**
 * Parse a DingTalk chatId to extract type and conversationId.
 */
function parseChatId(
  chatId: string,
): { type: 'c2c' | 'group'; conversationId: string } | null {
  if (chatId.startsWith('dingtalk:c2c:')) {
    return { type: 'c2c', conversationId: chatId.slice(13) };
  }
  if (chatId.startsWith('dingtalk:group:')) {
    return { type: 'group', conversationId: chatId.slice(15) };
  }
  if (chatId.startsWith('cid')) {
    return { type: 'group', conversationId: chatId };
  }
  return null;
}

function convertToDingTalkMarkdown(md: string): string {
  let text = md;
  // Images: ![alt](url) → alt (DingTalk doesn't render inline images)
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Strikethrough: ~~text~~ → text (not supported)
  text = text.replace(/~~(.+?)~~/g, '$1');
  return text;
}

// -- Channel Adapter --

export class DingTalkChannel implements ChannelAdapter {
  readonly name = 'dingtalk';

  private config: BotConfig;
  private clientId: string;
  private clientSecret: string;
  private debug: boolean;

  // SDK client state
  private dwClient: unknown | null = null;
  private stopping = false;

  // Token state
  private tokenInfo: DingTalkAccessToken | null = null;

  // Deduplication
  private dedup = new DedupCache();

  // Per-chat state
  private sessionWebhooks = new Map<string, string>();
  private senderStaffIds = new Map<string, string>();
  private ackReactions = new Map<string, { msgId: string; conversationId: string }>();

  // Download code cache: messageId -> downloadCode
  private downloadCodes = new Map<string, string>();

  // Handlers
  private messageHandlers: Array<(msg: NormalizedMessage) => void> = [];
  private cardActionHandlers: Array<(action: CardAction) => void> = [];

  private streamSdk?: DingTalkStreamSdk;

  constructor(config: BotConfig, options: DingTalkChannelOptions = {}) {
    this.config = config;
    this.clientId = config.credentials?.clientId ?? '';
    this.clientSecret = config.credentials?.clientSecret ?? '';
    this.debug = config.credentials?.debug === 'true' || config.credentials?.debug === '1';
    this.streamSdk = options.streamSdk;
  }

  // -- ChannelAdapter interface --

  async start(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      logger.info('DingTalk clientId/clientSecret not configured, skipping');
      return;
    }

    this.stopping = false;

    try {
      // Temporarily disable axios proxy to avoid DingTalk SDK connection issues
      let originalProxy: unknown = undefined;
      try {
        const axios = (await import('axios')).default;
        originalProxy = axios.defaults?.proxy;
        if (axios.defaults) {
          axios.defaults.proxy = false;
        }
      } catch {
        // axios may not be installed — continue without proxy fix
      }

      const streamSdk = this.streamSdk ?? await loadDingTalkStreamSdk();
      logger.info({ clientId: this.clientId.slice(0, 12), clientIdFull: this.clientId.startsWith('enc:') ? 'ENCRYPTED-BUG' : 'ok' }, 'DingTalk Stream connecting...');
      this.dwClient = new streamSdk.DWClient({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        debug: this.debug,
        keepAlive: true,
      });

      // Restore axios proxy
      if (originalProxy !== undefined) {
        try {
          const axios = (await import('axios')).default;
          if (axios.defaults) {
            (axios.defaults as { proxy: unknown }).proxy = originalProxy;
          }
        } catch {
          // axios not available, nothing to restore
        }
      }

      // Register robot message callback
      const client = this.dwClient as DingTalkStreamClient;

      if ('registerAllEventListener' in client) {
        (client as DingTalkStreamClient & {
          registerAllEventListener: (cb: (downstream: DingTalkDownstream) => unknown) => unknown;
        }).registerAllEventListener((downstream) => {
          logger.info({ topic: downstream.headers?.topic, hasData: !!downstream.data }, 'DingTalk all-event listener fired');
          if (downstream.headers?.topic === streamSdk.TOPIC_ROBOT) {
            this.handleRobotMessage(downstream.data).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error({ err: msg }, 'Error in DingTalk event message handler');
            });
            return { status: 'SUCCESS' };
          }
          return { status: 'SUCCESS' };
        });
      }

      client.registerCallbackListener(streamSdk.TOPIC_ROBOT, async (downstream) => {
        logger.info({ topic: downstream.headers?.topic, hasMessageId: !!downstream.headers?.messageId }, 'DingTalk callback fired');
        const messageId = downstream.headers?.messageId;
        if (messageId) {
          client.socketCallBackResponse(messageId, { success: true });
        }
        await this.handleRobotMessage(downstream.data).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err: msg }, 'Error in DingTalk message handler');
        });
      });

      await client.connect();
      logger.info(
        { bot: this.config.name, clientId: this.clientId.slice(0, 8), hasAllEventListener: 'registerAllEventListener' in client },
        'DingTalk Stream connected',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, bot: this.config.name }, 'DingTalk initial connection failed');
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.dwClient) {
      try {
        (this.dwClient as { disconnect: () => void }).disconnect();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug({ err: msg }, 'Error disconnecting DingTalk client');
      }
      this.dwClient = null;
    }

    this.tokenInfo = null;
    this.sessionWebhooks.clear();
    this.senderStaffIds.clear();
    this.ackReactions.clear();
    logger.info('DingTalk bot disconnected');
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

  async send(chatId: string, text: string): Promise<void> {
    const parsed = parseChatId(chatId);
    if (!parsed) {
      logger.error({ chatId }, 'Invalid DingTalk chat ID format');
      return;
    }

    if (parsed.type === 'c2c') {
      await this.sendC2cMessage(parsed.conversationId, text);
    } else {
      await this.sendGroupMessage(parsed.conversationId, text);
    }
  }

  sendStreaming(chatId: string): StreamingHandle {
    const parsed = parseChatId(chatId);
    if (parsed?.type === 'c2c') {
      return this.createC2cTextStreamingHandle(chatId);
    }

    const cardConfig: DingTalkCardConfig = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    };

    const target = parsed
      ? { type: 'group' as const, openConversationId: parsed.conversationId }
      : { type: 'group' as const, openConversationId: chatId };

    const card = new DingTalkStreamingCard(cardConfig, target, {
      fallbackSend: (text: string) => this.send(chatId, text),
    });

    return {
      update: (text: string) => card.append(text),
      finalize: (text: string) => card.complete(text).catch(() => {}),
      updateToolStatus: (info) => {
        const toolId = `tool_${info.toolName}`;
        if (info.status === 'running') {
          card.startTool(toolId, info.toolName);
        } else {
          card.endTool(toolId, info.status === 'error');
        }
      },
      abort: () => card.abort().catch(() => {}),
      delete: () => card.dispose(),
    };
  }

  private createC2cTextStreamingHandle(chatId: string): StreamingHandle {
    let lastText = '';
    let finalized = false;
    let lastSentText = '';

    // Send an immediate "processing" indicator
    this.send(chatId, '⏳ 正在处理...').catch(() => {});

    // Periodically send intermediate text so user sees progress
    const DEBOUNCE_MS = 3000;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const flushIntermediate = () => {
      const text = lastText.trim();
      if (!text || text === lastSentText.trim()) return;
      lastSentText = text;
      this.send(chatId, text).catch(() => {});
    };

    const finalize = (text: string) => {
      if (finalized) return;
      finalized = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      const finalText = text.trim() || lastText.trim();
      if (!finalText) return;
      this.send(chatId, finalText).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg, chatId }, 'DingTalk C2C text reply failed');
      });
    };

    return {
      update: (text: string) => {
        lastText = text;
        if (!debounceTimer) {
          debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            flushIntermediate();
          }, DEBOUNCE_MS);
        }
      },
      finalize,
      updateToolStatus: () => {},
      abort: () => {
        finalize('抱歉，处理消息时出现错误，请稍后重试。');
      },
      delete: () => {
        if (debounceTimer) clearTimeout(debounceTimer);
      },
    };
  }

  async react(messageId: string, _emoji: string): Promise<void> {
    // DingTalk only supports one reaction type ("ack" / thinking emoji).
    // The emoji parameter is accepted for interface compatibility but ignored.
    for (const [chatId, stored] of this.ackReactions) {
      if (stored.msgId === messageId) {
        await this.attachAckReaction(chatId, stored.msgId, stored.conversationId);
        return;
      }
    }
    logger.debug({ messageId }, 'DingTalk react: no matching ackReaction found');
  }

  async downloadFile(fileRef: {
    messageId: string;
    fileName: string;
  }): Promise<DownloadedFile> {
    // Find downloadCode from ackReaction context
    const downloadCode = await this.resolveDownloadCode(fileRef.messageId);
    if (!downloadCode) {
      throw new Error(`Cannot resolve download code for message ${fileRef.messageId}`);
    }

    const buffer = await this.downloadByCode(downloadCode);
    if (!buffer) {
      throw new Error(`Failed to download file ${fileRef.fileName}`);
    }

    return {
      type: 'file',
      name: fileRef.fileName,
      localPath: '',
      mimeType: 'application/octet-stream',
      textContent: extractFileText(buffer, fileRef.fileName),
    };
  }

  // -- Message handling --

  async handleRobotMessage(rawData: string): Promise<void> {
    try {
      const raw = JSON.parse(rawData) as unknown;
      const data: DingTalkRobotMessage = dingtalkRobotMessageSchema.parse(raw);
      const msgId = data.msgId;

      if (!msgId || !this.dedup.claim(msgId)) {
        return;
      }

      const conversationId = data.conversationId;
      const isGroup = data.conversationType === '2';
      const jid = isGroup
        ? `dingtalk:group:${conversationId}`
        : `dingtalk:c2c:${data.senderId}`;

      // Store session webhook and sender info
      if (data.sessionWebhook) {
        this.sessionWebhooks.set(jid, data.sessionWebhook);
      }
      if (data.senderStaffId) {
        this.senderStaffIds.set(jid, data.senderStaffId);
      }

      // Parse message content
      const { content, files } = await this.parseMessageContent(data, jid);

      if (!content && (!files || files.length === 0)) {
        logger.info(
          { msgId, chatId: jid, msgtype: data.msgtype },
          'DingTalk message ignored: empty content',
        );
        return;
      }

      logger.info(
        {
          msgId,
          chatId: jid,
          msgtype: data.msgtype,
          contentLen: content?.length ?? 0,
          hasFiles: !!files?.length,
          isGroup,
        },
        'DingTalk message parsed',
      );

      this.ackReactions.set(jid, { msgId, conversationId });

      // Build normalized message
      const msg: NormalizedMessage = {
        id: msgId,
        chatId: jid,
        text: content ?? '',
        source: 'user',
        channelId: 'dingtalk',
        fromBotName: undefined,
        fromUserId: data.senderStaffId || undefined,
        receivedAt: Date.now(),
        files,
      };

      // Route to handlers
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, 'Error handling DingTalk robot message');
    }
  }

  // -- Pure parsing functions (exported for testing) --

  /**
   * Parse raw DingTalk robot message data into content + files.
   */
  async parseMessageContent(
    data: DingTalkRobotMessage,
    jid: string,
  ): Promise<{ content: string; files?: FileAttachment[] }> {
    let content = '';
    let files: FileAttachment[] | undefined;

    if (data.msgtype === 'text' && data.text) {
      const userText = data.text.content?.trim() || '';
      const reply = data.text.isReplyMsg
        ? extractRepliedMsg(data.text.repliedMsg as RepliedMsg | undefined, data.originalMsgId)
        : null;

      if (reply) {
        content = this.buildReplyContent(userText, reply);
      } else {
        content = userText;
      }
    } else if (data.msgtype === 'richText' && data.content?.richText) {
      const textParts: string[] = [];
      for (const entry of data.content.richText) {
        if (entry.text) textParts.push(entry.text);
      }
      content = textParts.join('').trim();
    } else if (data.msgtype === 'picture' && data.content) {
      content = '[picture]';
      const code = data.content.pictureDownloadCode;
      if (code) {
        this.downloadCodes.set(data.msgId, code);
        const file = await this.buildPictureAttachment(code, data.msgId);
        files = file ? [file] : [{ type: 'image', name: 'picture', localPath: '' }];
      }
    } else if (data.msgtype === 'file' && data.content) {
      const fileName = data.content.fileName || 'file';
      content = `[file: ${fileName}]`;
      const code = data.content.downloadCode;
      if (code) {
        this.downloadCodes.set(data.msgId, code);
        const file = await this.buildFileAttachment(code, fileName);
        files = file ? [file] : [{ type: 'file', name: fileName, localPath: '' }];
      }
    } else if (data.msgtype === 'image' && data.image) {
      content = '[image]';
    }

    return { content, files };
  }

  /**
   * Build content string from a reply-to message.
   */
  buildReplyContent(userText: string, reply: { kind: string; textContent?: string; fileName?: string }): string {
    if (reply.kind === 'text' && reply.textContent) {
      const quoted = reply.textContent
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return userText ? `${quoted}\n\n${userText}` : quoted;
    }
    if (reply.kind === 'file' && reply.fileName) {
      const prefix = `[quoted file: ${reply.fileName}]`;
      return userText ? `${prefix}\n${userText}` : prefix;
    }
    if (reply.kind === 'picture') {
      const prefix = '[quoted picture]';
      return userText ? `${prefix}\n${userText}` : prefix;
    }
    const quoted = reply.textContent
      ? reply.textContent.split('\n').map((l) => `> ${l}`).join('\n')
      : '> [unparseable quoted content]';
    return userText ? `${quoted}\n\n${userText}` : quoted;
  }

  // -- Eager file download helpers --

  /**
   * Download a picture and return a FileAttachment with base64 if small enough.
   * Returns null if download fails (non-blocking).
   */
  private async buildPictureAttachment(
    code: string,
    _msgId: string,
  ): Promise<FileAttachment | null> {
    try {
      const token = await this.getAccessToken();
      const buffer = await downloadByCode(code, token, this.clientId);
      if (!buffer || buffer.length === 0) return null;

      if (buffer.length <= MAX_IMAGE_BASE64_SIZE) {
        const base64 = buffer.toString('base64');
        return { type: 'image', name: 'picture', localPath: '', mimeType: 'image/png', base64 };
      }

      return { type: 'image', name: 'picture', localPath: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug({ err: msg }, 'Failed to eagerly download picture');
      return null;
    }
  }

  /**
   * Download a file and return a FileAttachment with textContent extracted.
   * Returns null if download fails (non-blocking).
   */
  private async buildFileAttachment(
    code: string,
    fileName: string,
  ): Promise<FileAttachment | null> {
    try {
      const token = await this.getAccessToken();
      const buffer = await downloadByCode(code, token, this.clientId);
      if (!buffer || buffer.length === 0) return null;

      const textContent = extractFileText(buffer, fileName);
      return { type: 'file', name: fileName, localPath: '', textContent };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug({ err: msg }, 'Failed to eagerly download file');
      return null;
    }
  }

  // -- Token management --

  private async getAccessToken(): Promise<string> {
    if (this.tokenInfo && Date.now() < this.tokenInfo.expiresAt - 300_000) {
      return this.tokenInfo.token;
    }

    return new Promise<string>((resolve, reject) => {
      const url = new URL('https://oapi.dingtalk.com/gettoken');
      url.searchParams.set('appkey', this.clientId);
      url.searchParams.set('appsecret', this.clientSecret);

      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, method: 'GET' },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (data.errcode !== 0) {
                reject(new Error(`DingTalk token error: ${data.errmsg}`));
                return;
              }
              const expiresIn = Number(data.expires_in) || 7200;
              this.tokenInfo = {
                token: data.access_token,
                expiresAt: Date.now() + expiresIn * 1000,
              };
              resolve(data.access_token);
            } catch (err) {
              reject(err);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  // -- REST API helper --

  private async apiRequest<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path, DINGTALK_API_BASE);
    const bodyStr = body ? JSON.stringify(body) : undefined;

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method,
          headers: {
            'x-acs-dingtalk-access-token': token,
            'Content-Type': 'application/json',
            ...(bodyStr
              ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            try {
              const data = JSON.parse(text);
              if (res.statusCode && res.statusCode >= 400) {
                reject(
                  new Error(
                    `DingTalk API ${method} ${path} failed (${res.statusCode}): ${data.message || data.msg || text}`,
                  ),
                );
                return;
              }
              resolve(data as T);
            } catch {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`DingTalk API ${method} ${path} failed (${res.statusCode}): ${text}`));
              } else {
                resolve({} as T);
              }
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // -- Message sending --

  private async sendC2cMessage(conversationId: string, text: string): Promise<void> {
    const senderStaffId = this.senderStaffIds.get(`dingtalk:c2c:${conversationId}`);
    if (!senderStaffId) {
      const webhook = this.sessionWebhooks.get(`dingtalk:c2c:${conversationId}`);
      if (webhook) {
        await this.sendViaWebhook(webhook, text);
        return;
      }
      logger.warn({ conversationId }, 'No senderStaffId or webhook for C2C message');
      return;
    }

    const plainText = markdownToPlainText(text);
    const chunks = splitTextChunks(plainText, DINGTALK_CHUNK_LIMIT);

    for (const chunk of chunks) {
      const sent = await this.batchSendC2c(senderStaffId, 'sampleText', JSON.stringify({ content: chunk }));
      if (!sent) {
        logger.warn(
          { conversationId, senderStaffId, chunkLen: chunk.length },
          'DingTalk C2C message send returned false',
        );
      }
    }

    logger.info({ conversationId, chunks: chunks.length, textLen: plainText.length }, 'DingTalk C2C message sent');

    this.clearAckReaction(`dingtalk:c2c:${conversationId}`);
  }

  private async sendGroupMessage(openConversationId: string, text: string): Promise<void> {
    const dtMarkdown = convertToDingTalkMarkdown(text);
    const chunks = splitTextChunks(dtMarkdown, DINGTALK_CHUNK_LIMIT);

    for (const chunk of chunks) {
      await this.sendGroupRaw(openConversationId, 'sampleMarkdown', JSON.stringify({ title: chunk.slice(0, 50), text: chunk }));
    }

    this.clearAckReaction(`dingtalk:group:${openConversationId}`);
  }

  clearAckReaction(chatId: string): void {
    const stored = this.ackReactions.get(chatId);
    if (stored) {
      this.apiRequest('POST', '/v1.0/robot/emotion/recall', {
        robotCode: this.clientId,
        openMsgId: stored.msgId,
        openConversationId: stored.conversationId,
      }).catch(() => {});
      this.ackReactions.delete(chatId);
    }
  }

  async sendImage(chatId: string, imageBuffer: Buffer, mimeType: string, _caption?: string): Promise<boolean> {
    const mediaId = await this.uploadDingTalkMedia(imageBuffer, 'image.png', 'image');
    if (!mediaId) return false;

    const parsed = parseChatId(chatId);
    if (!parsed) {
      logger.error({ chatId }, 'Invalid DingTalk chat ID for sendImage');
      return false;
    }

    if (parsed.type === 'c2c') {
      const senderStaffId = this.senderStaffIds.get(chatId);
      if (senderStaffId) {
        return await this.batchSendC2c(senderStaffId, 'sampleImage', JSON.stringify({ photoURL: `mediaId:${mediaId}` }));
      }
    } else {
      try {
        await this.sendGroupRaw(parsed.conversationId, 'sampleImage', JSON.stringify({ photoURL: `mediaId:${mediaId}` }));
        return true;
      } catch {
      return false;
      }
    }
    return false;
  }

  async sendFile(chatId: string, filePath: string, fileName: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile(filePath);
    const mediaId = await this.uploadDingTalkMedia(buffer, fileName, 'file');
    if (!mediaId) return false;

    const parsed = parseChatId(chatId);
    if (!parsed) {
      logger.error({ chatId }, 'Invalid DingTalk chat ID for sendFile');
      return false;
    }

    if (parsed.type === 'c2c') {
      const senderStaffId = this.senderStaffIds.get(chatId);
      if (senderStaffId) {
        return await this.batchSendC2c(senderStaffId, 'sampleFile', JSON.stringify({ mediaId, fileName }));
      }
    } else {
      try {
        await this.sendGroupRaw(parsed.conversationId, 'sampleFile', JSON.stringify({ mediaId, fileName }));
        return true;
      } catch {
      return false;
      }
    }
    return false;
  }

  // -- Internal send helpers --

  private async batchSendC2c(senderStaffId: string, msgKey: string, msgParam: string): Promise<boolean> {
    const token = await this.getAccessToken();
    const body = JSON.stringify({ robotCode: this.clientId, userIds: [senderStaffId], msgKey, msgParam });

    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: 'api.dingtalk.com',
            path: '/v1.0/robot/oToMessages/batchSend',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const responseText = Buffer.concat(chunks).toString('utf8');
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`DingTalk batchSend failed (${res.statusCode}): ${responseText}`));
                return;
              }
              logger.info(
                { statusCode: res.statusCode, senderStaffId, responseLen: responseText.length },
                'DingTalk batchSend request completed',
              );
              resolve();
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      return true;
    } catch (err) {
      logger.warn({ err, senderStaffId }, 'DingTalk batchSend failed');
      return false;
    }
  }

  private async sendGroupRaw(openConversationId: string, msgKey: string, msgParam: string): Promise<void> {
    const token = await this.getAccessToken();
    const body = JSON.stringify({ openConversationId, robotCode: this.clientId, msgKey, msgParam });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.dingtalk.com',
          path: '/v1.0/robot/groupMessages/send',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`DingTalk group send failed (${res.statusCode})`));
              return;
            }
            resolve();
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async uploadDingTalkMedia(fileBuffer: Buffer, fileName: string, type: string): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      const boundary = `----FormBoundary${Date.now()}`;
      const CRLF = '\r\n';
      const parts: Buffer[] = [];

      parts.push(Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="type"${CRLF}${CRLF}${type}${CRLF}`,
        'utf8',
      ));
      const header = `--${boundary}${CRLF}Content-Disposition: form-data; name="media"; filename="${fileName}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`;
      parts.push(Buffer.from(header, 'utf8'));
      parts.push(fileBuffer);
      parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8'));
      const body = Buffer.concat(parts);

      const result = await new Promise<{ media_id?: string; errcode?: number }>((resolve, reject) => {
        const req = https.request(
          {
            hostname: 'oapi.dingtalk.com',
            path: `/media/upload?access_token=${token}&type=${type}`,
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
              catch { reject(new Error('Invalid JSON from DingTalk media upload')); }
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (result.errcode && result.errcode !== 0) {
        logger.warn({ errcode: result.errcode }, 'DingTalk media upload failed');
        return null;
      }
      return result.media_id ?? null;
    } catch (err) {
      logger.warn({ err }, 'Failed to upload DingTalk media');
      return null;
    }
  }

  private async sendViaWebhook(webhook: string, text: string): Promise<void> {
    const body = JSON.stringify({
      msgtype: 'markdown',
      markdown: { title: text.slice(0, 50), text },
    });

    await new Promise<void>((resolve, reject) => {
      const url = new URL(webhook);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`DingTalk webhook send failed (${res.statusCode})`));
              return;
            }
            resolve();
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // -- Ack reaction --

  private async attachAckReaction(
    chatId: string,
    msgId: string,
    conversationId: string,
  ): Promise<void> {
    const delays = [0, 400, 1200];

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        await this.apiRequest('POST', '/v1.0/robot/emotion/reply', {
          robotCode: this.clientId,
          openMsgId: msgId,
          openConversationId: conversationId,
          emotionType: 2,
          emotionName: 'thinking',
          textEmotion: {
            emotionId: '2659900',
            emotionName: 'thinking',
            text: 'thinking',
            backgroundId: 'im_bg_1',
          },
        });
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (i === delays.length - 1) {
          logger.warn({ err: msg, msgId, conversationId, chatId }, 'DingTalk ack reaction attach failed');
        }
      }
    }
  }

  // -- File download --

  private async resolveDownloadCode(messageId: string): Promise<string | null> {
    return this.downloadCodes.get(messageId) ?? null;
  }

  private async downloadByCode(code: string): Promise<Buffer | null> {
    const token = await this.getAccessToken();
    return downloadByCode(code, token, this.clientId);
  }
}
