import type { NormalizedMessage, FileAttachment } from './types.js';

export interface StreamingHandle {
  update(text: string): void;
  finalize(text: string): void;
  updateToolStatus(info: {
    toolName: string;
    status: 'running' | 'complete' | 'error';
    elapsedMs?: number;
  }): void;
  abort(): void;
  delete(): void;
  updateThinking?(text: string): void;
  setThinking?(active: boolean): void;
  setSystemStatus?(status: string | null): void;
  setTodos?(todos: Array<{ id: string; content: string; status: string }>): void;
}

export interface CardAction {
  chatId: string;
  messageId: string;
  action: string;
  value?: Record<string, unknown>;
  chatJid?: string;
}

export interface DownloadedFile extends FileAttachment {
  textContent?: string;
  base64?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: NormalizedMessage) => void): () => void;
  onCardAction(handler: (action: CardAction) => void): () => void;
  send(chatId: string, text: string): Promise<void>;
  sendStreaming(chatId: string): StreamingHandle;
  react(messageId: string, emoji: string): Promise<void>;
  downloadFile(fileRef: {
    messageId: string;
    fileName: string;
  }): Promise<DownloadedFile>;
  sendImage?(chatId: string, imageBuffer: Buffer, mimeType: string, caption?: string): Promise<boolean>;
  sendFile?(chatId: string, filePath: string, fileName: string): Promise<boolean>;
  clearAckReaction?(chatId: string): void;
}
