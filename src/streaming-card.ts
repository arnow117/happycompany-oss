import type * as lark from '@larksuiteoapi/node-sdk';
import { logger } from './logger.js';

const ELEMENT_MAIN = 'main';
const ELEMENT_STATUS = 'status_note';
const ELEMENT_TOOL = 'tool_status';
const ELEMENT_INTERRUPT = 'interrupt_btn';

type CardState = 'streaming' | 'completed' | 'aborted';

const HEADER_TEMPLATE: Record<CardState, string> = {
  streaming: 'blue',
  completed: 'violet',
  aborted: 'orange',
};

const STATUS_NOTE: Record<CardState, string> = {
  streaming: '⏳ 生成中...',
  completed: '',
  aborted: '⚠️ 已中断',
};

/** Typewriter speed hints (cribbed from happycompany). */
const STREAMING_CONFIG = {
  print_frequency_ms: { default: 50 },
  print_step: { default: 2 },
  print_strategy: 'fast' as const,
};

const TITLE_MAX_LEN = 40;

/**
 * Extract a display-friendly title from content text:
 * - Use leading `#`/`##`/`###` heading if present
 * - Otherwise use the first non-empty line, stripped of markdown chars,
 *   truncated to TITLE_MAX_LEN
 */
function extractTitle(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#{1,3}\s+(.*)$/);
    if (heading) return heading[1]!.trim().slice(0, TITLE_MAX_LEN);
    const stripped = t.replace(/[*_`#[\]]/g, '').trim();
    return stripped.length > TITLE_MAX_LEN
      ? stripped.slice(0, TITLE_MAX_LEN - 1) + '…'
      : stripped;
  }
  return '';
}

/**
 * Feishu streaming card wrapper aligned with happycompany's latest v2 schema:
 * - `schema: '2.0'`, `width_mode: 'fill'`
 * - Colored header (blue streaming -> violet completed -> orange aborted)
 * - `streaming_config` for controlled typewriter speed
 * - Dynamic title (bot name during streaming -> content-derived on finalize)
 * - Native typewriter via `cardkit.v1.cardElement.content`
 */
export class StreamingCard {
  private cardId: string | null = null;
  private _messageId: string | null = null;
  private sequence = 0;
  private lastSentText = '';
  private lastToolStatus = '';

  constructor(
    private readonly client: lark.Client,
    private readonly botName: string,
  ) {}

  get messageId(): string | null {
    return this._messageId;
  }

  getCardId(): string | null {
    return this.cardId;
  }

  async start(chatId: string, initialText = '...'): Promise<string> {
    const cardJson = buildCardJson(this.botName, this.botName, initialText, 'streaming');

    const cardResp = (await this.client.cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(cardJson) },
    })) as { data?: { card_id?: string }; code?: number; msg?: string };
    const cardId = cardResp.data?.card_id;
    if (!cardId) {
      throw new Error(
        `cardkit.v1.card.create returned no card_id (code=${cardResp.code}, msg=${cardResp.msg})`,
      );
    }
    this.cardId = cardId;
    this.sequence = 1;

    const content = JSON.stringify({
      type: 'card',
      data: { card_id: cardId },
    });
    const msgResp = (await this.client.im.v1.message.create({
      params: { receive_id_type: chatId.startsWith('oc_') ? 'chat_id' : 'open_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content,
      },
    })) as { data?: { message_id?: string } };
    const messageId = msgResp.data?.message_id;
    if (!messageId) {
      throw new Error('card send returned no message_id');
    }
    this._messageId = messageId;
    this.lastSentText = initialText;
    return messageId;
  }

  async update(text: string): Promise<void> {
    if (!this.cardId) return;
    if (text === this.lastSentText) return;
    try {
      await this.client.cardkit.v1.cardElement.content({
        path: { card_id: this.cardId, element_id: ELEMENT_MAIN },
        data: { content: text, sequence: ++this.sequence },
      });
      this.lastSentText = text;
    } catch (err) {
      logger.warn({ err, cardId: this.cardId }, 'Streaming card update failed');
    }
  }

  /**
   * Update the tool-status auxiliary element (small text line).
   * Pass an empty string to clear.
   */
  async updateToolStatus(text: string): Promise<void> {
    if (!this.cardId) return;
    if (text === this.lastToolStatus) return;
    try {
      await this.client.cardkit.v1.cardElement.content({
        path: { card_id: this.cardId, element_id: ELEMENT_TOOL },
        data: { content: text || ' ', sequence: ++this.sequence },
      });
      this.lastToolStatus = text;
    } catch (err) {
      logger.debug({ err, cardId: this.cardId }, 'Tool status update failed (non-critical)');
    }
  }

  async finalize(finalText: string): Promise<void> {
    if (!this.cardId) return;
    try {
      await this.update(finalText);
    } catch {
      // non-fatal
    }
    // Content-derived title for the finalized preview, falling back to bot name.
    const derivedTitle = extractTitle(finalText) || this.botName;
    try {
      const cardJson = buildCardJson(
        derivedTitle,
        this.botName,
        finalText,
        'completed',
      );
      await this.client.cardkit.v1.card.update({
        path: { card_id: this.cardId },
        data: {
          card: { type: 'card_json', data: JSON.stringify(cardJson) },
          sequence: ++this.sequence,
        },
      });
    } catch (err) {
      logger.debug(
        { err, cardId: this.cardId },
        'Full card rewrite on finalize failed (non-critical)',
      );
    }
    try {
      await this.client.cardkit.v1.card.settings({
        path: { card_id: this.cardId },
        data: {
          settings: JSON.stringify({ config: { streaming_mode: false } }),
          sequence: ++this.sequence,
        },
      });
    } catch (err) {
      logger.debug(
        { err, cardId: this.cardId },
        'streaming_mode disable failed (non-critical)',
      );
    }
  }

  /**
   * Delete the Feishu message entirely. Used when the agent decided to stay
   * silent -- we'd rather have the card vanish than hang around saying
   * something empty.
   */
  async deleteMessage(): Promise<void> {
    if (!this._messageId) return;
    try {
      await this.client.im.v1.message.delete({
        path: { message_id: this._messageId },
      });
    } catch (err) {
      logger.debug(
        { err, messageId: this._messageId },
        'Card delete failed (non-critical)',
      );
    }
  }
}

function buildCardJson(
  title: string,
  botName: string,
  content: string,
  state: CardState,
): object {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: 'markdown',
      element_id: ELEMENT_MAIN,
      content: content || '...',
    },
  ];

  if (state === 'streaming') {
    elements.push({
      tag: 'markdown',
      element_id: ELEMENT_TOOL,
      content: ' ',
      text_size: 'notation',
    });
    elements.push({
      tag: 'button',
      element_id: ELEMENT_INTERRUPT,
      text: { tag: 'plain_text', content: '⏹ 中断回复' },
      type: 'danger',
      value: { action: 'interrupt' },
    });
  }

  const note = STATUS_NOTE[state];
  if (note) {
    elements.push({
      tag: 'markdown',
      element_id: ELEMENT_STATUS,
      content: note,
      text_size: 'notation',
    });
  }

  const config: Record<string, unknown> = {
    width_mode: 'fill',
    summary: { content: botName },
  };
  if (state === 'streaming') {
    config.streaming_mode = true;
    config.streaming_config = STREAMING_CONFIG;
  } else {
    config.streaming_mode = false;
  }

  return {
    schema: '2.0',
    config,
    header: {
      title: { tag: 'plain_text', content: title },
      template: HEADER_TEMPLATE[state],
    },
    body: { elements },
  };
}
