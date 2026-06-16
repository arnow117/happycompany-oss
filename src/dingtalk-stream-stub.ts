/**
 * Runtime stub for dingtalk-stream types.
 *
 * The actual SDK is loaded dynamically in DingTalkChannel.start() via
 * `import('dingtalk-stream')`. This module provides the type shapes
 * that TypeScript and the channel code need at compile time.
 *
 * When the real SDK is installed, the dynamic import in start() will
 * resolve to the actual package. This file only provides types and
 * a fallback for environments where the SDK is not yet installed.
 */

export const TOPIC_ROBOT = 'TOPIC_ROBOT';

export interface DWClientDownStream {
  data: string;
  headers?: { messageId?: string };
}

export class DWClient {
  constructor(_opts?: {
    clientId: string;
    clientSecret: string;
    debug?: boolean;
    keepAlive?: boolean;
  }) {}

  registerCallbackListener(
    _topic: string,
    _cb: (downstream: DWClientDownStream) => Promise<void>,
  ): void {}

  socketCallBackResponse(_messageId: string, _response: unknown): void {}

  async connect(): Promise<void> {}

  disconnect(): void {}
}
