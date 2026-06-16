/**
 * DingTalk AI Card Streaming Controller
 *
 * Implements DingTalk AI Card lifecycle for streaming responses:
 *   1. POST /v1.0/card/instances        -> create card
 *   2. POST /v1.0/card/instances/deliver -> deliver to user/group
 *   3. PUT  /v1.0/card/instances         -> switch to INPUTING
 *   4. PUT  /v1.0/card/streaming         -> stream content (throttled 500ms)
 *   5. PUT  /v1.0/card/streaming         -> isFinalize=true (last frame)
 *   6. PUT  /v1.0/card/instances         -> switch to FINISHED
 *
 * Extracted and adapted from happycompany's dingtalk-streaming-card.ts.
 */

import https from 'node:https';
import { logger } from './logger.js';

// -- Constants --

const DINGTALK_API_BASE = 'https://api.dingtalk.com';
const AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema';

const FlowStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

const STREAM_UPDATE_INTERVAL = 500; // ms — 2 QPS throttle

// -- Types --

export interface DingTalkCardConfig {
  clientId: string;
  clientSecret: string;
}

export type DingTalkCardTarget =
  | { type: 'user'; userId: string }
  | { type: 'group'; openConversationId: string };

type StreamingState =
  | 'idle'
  | 'creating'
  | 'streaming'
  | 'completed'
  | 'aborted'
  | 'error';

interface TokenInfo {
  token: string;
  expiresAt: number;
}

// -- Token cache (shared across all card instances) --

const tokenCache = new Map<string, TokenInfo>();

async function getAccessToken(config: DingTalkCardConfig): Promise<string> {
  const cached = tokenCache.get(config.clientId);
  if (cached && Date.now() < cached.expiresAt - 300_000) {
    return cached.token;
  }

  return new Promise<string>((resolve, reject) => {
    const url = new URL('https://oapi.dingtalk.com/gettoken');
    url.searchParams.set('appkey', config.clientId);
    url.searchParams.set('appsecret', config.clientSecret);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
      },
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
            tokenCache.set(config.clientId, {
              token: data.access_token,
              expiresAt: Date.now() + expiresIn * 1000,
            });
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

// -- HTTP helper --

interface ApiResponse {
  [key: string]: unknown;
}

async function apiRequest(
  config: DingTalkCardConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse> {
  const token = await getAccessToken(config);
  const url = new URL(path, DINGTALK_API_BASE);
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise<ApiResponse>((resolve, reject) => {
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
            if (
              data.code &&
              data.code !== '0' &&
              data.code !== '200' &&
              data.code !== 'success'
            ) {
              reject(
                new Error(
                  `DingTalk Card API ${method} ${path} error: code=${data.code}, message=${data.message || data.msg || text}`,
                ),
              );
              return;
            }
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `DingTalk Card API ${method} ${path} HTTP failed (${res.statusCode}): ${data.message || text}`,
                ),
              );
              return;
            }
            resolve(data as ApiResponse);
          } catch {
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `DingTalk Card API ${method} ${path} HTTP failed (${res.statusCode}): ${text}`,
                ),
              );
            } else {
              resolve({});
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

// -- Deliver body builder --

function buildDeliverBody(
  cardInstanceId: string,
  target: DingTalkCardTarget,
  robotCode: string,
): Record<string, unknown> {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };

  if (target.type === 'group') {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId}`,
      imGroupOpenDeliverModel: { robotCode },
    };
  }

  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId}`,
    imRobotOpenDeliverModel: {
      spaceType: 'IM_ROBOT',
      robotCode,
      extension: { dynamicSummary: 'true' },
    },
  };
}

// -- Controller --

export class DingTalkStreamingCard {
  private state: StreamingState = 'idle';
  private config: DingTalkCardConfig;
  private target: DingTalkCardTarget;

  // Card state
  private cardInstanceId: string | null = null;
  private inputingStarted = false;
  private accumulatedText = '';

  // Throttle
  private lastUpdateTime = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Tool tracking for auxiliary display
  private tools = new Map<
    string,
    { name: string; status: 'running' | 'complete' | 'error'; startTime: number }
  >();

  // Fallback
  private fallbackSend: ((text: string) => Promise<void>) | null;
  private fallbackUsed = false;

  // Card creation guard
  private cardCreationPromise: Promise<void> | null = null;

  constructor(
    config: DingTalkCardConfig,
    target: DingTalkCardTarget,
    opts?: { fallbackSend?: (text: string) => Promise<void> },
  ) {
    this.config = config;
    this.target = target;
    this.fallbackSend = opts?.fallbackSend ?? null;
  }

  // -- Lifecycle --

  isActive(): boolean {
    return (
      this.state === 'idle' ||
      this.state === 'creating' ||
      this.state === 'streaming'
    );
  }

  append(text: string): void {
    if (!this.isActive()) return;
    this.accumulatedText = text;
    this.scheduleFlush();
  }

  async complete(finalText: string): Promise<void> {
    if (this.state === 'completed' || this.state === 'aborted') return;
    this.accumulatedText = finalText;
    this.clearFlushTimer();

    if (!finalText.trim()) {
      this.state = 'completed';
      return;
    }

    try {
      await this.ensureCard();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'DingTalk AI Card ensureCard failed in complete()');
      await this.tryFallback(finalText);
      this.state = 'completed';
      return;
    }

    if (!this.cardInstanceId) {
      await this.tryFallback(finalText);
      this.state = 'completed';
      return;
    }

    try {
      await this.pushStreamingContent(finalText, true);
      await this.updateFlowStatus(FlowStatus.FINISHED, finalText);
      this.state = 'completed';
      logger.info({ cardId: this.cardInstanceId }, 'DingTalk AI Card completed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, cardId: this.cardInstanceId }, 'DingTalk AI Card finalize failed');
      await this.tryFallback(finalText);
      this.state = 'error';
    }
  }

  async abort(reason?: string): Promise<void> {
    if (this.state === 'completed' || this.state === 'aborted') return;
    this.clearFlushTimer();

    const displayText = this.accumulatedText
      ? this.accumulatedText + `\n\n> Warning: ${reason ?? 'cancelled'}`
      : `Warning: ${reason ?? 'cancelled'}`;

    if (!this.cardInstanceId) {
      this.state = 'aborted';
      return;
    }

    try {
      await this.pushStreamingContent(displayText, true);
      await this.updateFlowStatus(FlowStatus.FAILED, displayText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug({ err: msg }, 'DingTalk AI Card abort update failed');
    }
    this.state = 'aborted';
  }

  dispose(): void {
    this.clearFlushTimer();
  }

  getCardInstanceId(): string | null {
    return this.cardInstanceId;
  }

  // -- Tool status --

  startTool(toolId: string, toolName: string): void {
    this.tools.set(toolId, { name: toolName, status: 'running', startTime: Date.now() });
  }

  endTool(toolId: string, isError: boolean): void {
    const tc = this.tools.get(toolId);
    if (tc) {
      tc.status = isError ? 'error' : 'complete';
      this.purgeOldTools();
    }
  }

  private purgeOldTools(): void {
    const cutoff = Date.now() - 30_000;
    for (const [id, tc] of this.tools) {
      if (tc.status !== 'running' && tc.startTime < cutoff) {
        this.tools.delete(id);
      }
    }
  }

  private formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    return `${min}m ${Math.floor(sec % 60)}s`;
  }

  // -- Internal: card creation --

  private async ensureCard(): Promise<void> {
    if (this.cardInstanceId) return;

    if (this.cardCreationPromise) {
      await this.cardCreationPromise;
      return;
    }

    this.state = 'creating';
    this.cardCreationPromise = (async () => {
      try {
        const cardId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        await apiRequest(
          this.config,
          'POST',
          '/v1.0/card/instances',
          {
            cardTemplateId: AI_CARD_TEMPLATE_ID,
            outTrackId: cardId,
            cardData: {
              cardParamMap: { config: JSON.stringify({ autoLayout: true }) },
            },
            callbackType: 'STREAM',
            imGroupOpenSpaceModel: { supportForward: true },
            imRobotOpenSpaceModel: { supportForward: true },
          },
        );

        await apiRequest(
          this.config,
          'POST',
          '/v1.0/card/instances/deliver',
          buildDeliverBody(cardId, this.target, this.config.clientId),
        );

        this.cardInstanceId = cardId;
        this.state = 'streaming';
        logger.info({ cardId }, 'DingTalk AI Card created and delivered');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg }, 'DingTalk AI Card creation failed');
        this.state = 'error';
      } finally {
        this.cardCreationPromise = null;
      }
    })();

    try {
      await this.cardCreationPromise;
    } catch {
      // Already handled inside
    }
  }

  // -- Internal: streaming --

  private scheduleFlush(): void {
    if (this.flushTimer) return;

    const elapsed = Date.now() - this.lastUpdateTime;
    const delay = Math.max(0, STREAM_UPDATE_INTERVAL - elapsed);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.doFlush().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug({ err: msg }, 'DingTalk AI Card flush failed');
      });
    }, delay);
  }

  private async doFlush(): Promise<void> {
    if (!this.accumulatedText.trim()) return;

    if (this.state === 'error') {
      await this.tryFallback(this.accumulatedText);
      return;
    }

    await this.ensureCard();

    if (!this.cardInstanceId) {
      await this.tryFallback(this.accumulatedText);
      return;
    }

    await this.pushStreamingContent(this.accumulatedText, false);
    this.lastUpdateTime = Date.now();
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async pushStreamingContent(
    content: string,
    isFinal: boolean,
  ): Promise<void> {
    if (!this.cardInstanceId) return;

    if (!this.inputingStarted) {
      await apiRequest(this.config, 'PUT', '/v1.0/card/instances', {
        outTrackId: this.cardInstanceId,
        cardData: {
          cardParamMap: {
            flowStatus: FlowStatus.INPUTING,
            msgContent: content,
            staticMsgContent: '',
            sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
            config: JSON.stringify({ autoLayout: true }),
          },
        },
      });
      this.inputingStarted = true;
    }

    await apiRequest(this.config, 'PUT', '/v1.0/card/streaming', {
      outTrackId: this.cardInstanceId,
      guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      key: 'msgContent',
      content,
      isFull: true,
      isFinalize: isFinal,
      isError: false,
    });
  }

  private async updateFlowStatus(
    flowStatus: string,
    content: string,
  ): Promise<void> {
    if (!this.cardInstanceId) return;

    await apiRequest(this.config, 'PUT', '/v1.0/card/instances', {
      outTrackId: this.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus,
          msgContent: content,
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
          config: JSON.stringify({ autoLayout: true }),
        },
      },
      cardUpdateOptions: { updateCardDataByKey: true },
    });
  }

  private async tryFallback(text: string): Promise<void> {
    if (this.fallbackUsed || !this.fallbackSend) return;
    this.fallbackUsed = true;
    try {
      await this.fallbackSend(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'DingTalk fallback send also failed');
    }
  }
}
