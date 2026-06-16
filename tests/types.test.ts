import { describe, it, expect } from 'vitest';
import type {
  MessageSource,
  FileAttachment,
  NormalizedMessage,
  BotConfig,
} from '../src/types.js';
import type {
  StreamingHandle,
  CardAction,
  DownloadedFile,
  ChannelAdapter,
} from '../src/channel.js';

describe('NormalizedMessage', () => {
  it('creates a user message with required fields', () => {
    const msg: NormalizedMessage = {
      id: 'msg-001',
      chatId: 'chat-001',
      text: 'hello',
      source: 'user',
      channelId: 'feishu',
      receivedAt: Date.now(),
    };

    expect(msg.id).toBe('msg-001');
    expect(msg.chatId).toBe('chat-001');
    expect(msg.text).toBe('hello');
    expect(msg.source).toBe('user');
    expect(msg.channelId).toBe('feishu');
    expect(msg.receivedAt).toBeTypeOf('number');
    expect(msg.files).toBeUndefined();
    expect(msg.replyTo).toBeUndefined();
    expect(msg.fromBotName).toBeUndefined();
  });

  it('creates a bot message with file attachments', () => {
    const file: FileAttachment = {
      type: 'image',
      name: 'screenshot.png',
      localPath: '/tmp/screenshot.png',
      mimeType: 'image/png',
    };

    const msg: NormalizedMessage = {
      id: 'msg-002',
      chatId: 'chat-002',
      text: 'see attached',
      source: 'bot',
      channelId: 'feishu',
      fromBotName: 'cal-bot',
      receivedAt: Date.now(),
      files: [file],
    };

    expect(msg.source).toBe('bot');
    expect(msg.fromBotName).toBe('cal-bot');
    expect(msg.files).toHaveLength(1);
    expect(msg.files![0].type).toBe('image');
    expect(msg.files![0].name).toBe('screenshot.png');
    expect(msg.files![0].localPath).toBe('/tmp/screenshot.png');
    expect(msg.files![0].mimeType).toBe('image/png');
  });

  it('creates a message with replyTo context', () => {
    const msg: NormalizedMessage = {
      id: 'msg-003',
      chatId: 'chat-001',
      text: 'looks good',
      source: 'user',
      channelId: 'feishu',
      receivedAt: Date.now(),
      replyTo: {
        messageId: 'msg-001',
        text: 'please review',
        files: [
          {
            type: 'file',
            name: 'report.pdf',
            localPath: '/tmp/report.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    };

    expect(msg.replyTo).toBeDefined();
    expect(msg.replyTo!.messageId).toBe('msg-001');
    expect(msg.replyTo!.text).toBe('please review');
    expect(msg.replyTo!.files).toHaveLength(1);
    expect(msg.replyTo!.files![0].name).toBe('report.pdf');
  });
});

describe('FileAttachment', () => {
  it('accepts all optional fields', () => {
    const file: FileAttachment = {
      type: 'file',
      name: 'data.csv',
      localPath: '/tmp/data.csv',
      mimeType: 'text/csv',
      textContent: 'id,name\n1,alice',
      base64: 'aWQsbmFtZQoxLGFsaWNl',
    };

    expect(file.type).toBe('file');
    expect(file.textContent).toBe('id,name\n1,alice');
    expect(file.base64).toBe('aWQsbmFtZQoxLGFsaWNl');
  });

  it('works with minimal fields', () => {
    const file: FileAttachment = {
      type: 'image',
      name: 'photo.jpg',
      localPath: '/tmp/photo.jpg',
    };

    expect(file.type).toBe('image');
    expect(file.mimeType).toBeUndefined();
    expect(file.textContent).toBeUndefined();
    expect(file.base64).toBeUndefined();
  });
});

describe('MessageSource', () => {
  it('accepts all valid source values', () => {
    const sources: MessageSource[] = ['user', 'bot', 'self'];
    expect(sources).toHaveLength(3);
  });
});

describe('BotConfig', () => {
  it('creates a bot config with required fields', () => {
    const config: BotConfig = {
      name: 'cal-bot',
      channel: 'feishu',
      credentials: { appId: 'cli_xxx', appSecret: 'secret' },
      displayName: 'Calendar Bot',
      agentDir: '/opt/agents/cal',
    };

    expect(config.name).toBe('cal-bot');
    expect(config.channel).toBe('feishu');
    expect(config.credentials.appId).toBe('cli_xxx');
    expect(config.displayName).toBe('Calendar Bot');
    expect(config.agentDir).toBe('/opt/agents/cal');
    expect(config.reactionEmoji).toBeUndefined();
    expect(config.cwd).toBeUndefined();
    expect(config.model).toBeUndefined();
  });

  it('creates a dingtalk bot config with optional fields', () => {
    const config: BotConfig = {
      name: 'task-bot',
      channel: 'dingtalk',
      credentials: { clientKey: 'key_xxx', clientSecret: 'secret' },
      displayName: 'Task Bot',
      agentDir: '/opt/agents/task',
      reactionEmoji: 'thumbsup',
      cwd: '/home/bot',
      model: 'claude-sonnet-4-20250514',
    };

    expect(config.channel).toBe('dingtalk');
    expect(config.reactionEmoji).toBe('thumbsup');
    expect(config.cwd).toBe('/home/bot');
    expect(config.model).toBe('claude-sonnet-4-20250514');
  });
});

describe('ChannelAdapter interface', () => {
  it('a mock class can implement the interface', async () => {
    let messageHandler: ((msg: NormalizedMessage) => void) | null = null;
    let cardActionHandler: ((action: CardAction) => void) | null = null;

    class MockAdapter implements ChannelAdapter {
      readonly name = 'mock';

      async start(): Promise<void> {}
      async stop(): Promise<void> {}
      async send(_chatId: string, _text: string): Promise<void> {}
      sendStreaming(_chatId: string): StreamingHandle {
        return {
          update(_text: string): void {},
          finalize(_text: string): void {},
          updateToolStatus(_info: {
            toolName: string;
            status: 'running' | 'complete' | 'error';
            elapsedMs?: number;
          }): void {},
          abort(): void {},
          delete(): void {},
        };
      }
      async react(_messageId: string, _emoji: string): Promise<void> {}
      async downloadFile(_fileRef: {
        messageId: string;
        fileName: string;
      }): Promise<DownloadedFile> {
        return {
          type: 'file',
          name: 'downloaded.txt',
          localPath: '/tmp/downloaded.txt',
          textContent: 'hello world',
        };
      }

      onMessage(handler: (msg: NormalizedMessage) => void): () => void {
        messageHandler = handler;
        return () => {
          messageHandler = null;
        };
      }

      onCardAction(handler: (action: CardAction) => void): () => void {
        cardActionHandler = handler;
        return () => {
          cardActionHandler = null;
        };
      }
    }

    const adapter = new MockAdapter();

    // Verify readonly name
    expect(adapter.name).toBe('mock');

    // Verify onMessage returns unsubscribe function
    const unsub = adapter.onMessage(() => {});
    expect(typeof unsub).toBe('function');

    // Verify onCardAction returns unsubscribe function
    const unsubAction = adapter.onCardAction(() => {});
    expect(typeof unsubAction).toBe('function');

    // Verify sendStreaming returns a valid handle
    const handle = adapter.sendStreaming('chat-001');
    expect(typeof handle.update).toBe('function');
    expect(typeof handle.finalize).toBe('function');
    expect(typeof handle.updateToolStatus).toBe('function');
    expect(typeof handle.abort).toBe('function');
    expect(typeof handle.delete).toBe('function');

    // Verify downloadFile returns DownloadedFile
    const downloaded = await adapter.downloadFile({
      messageId: 'msg-001',
      fileName: 'test.txt',
    });
    expect(downloaded.name).toBe('downloaded.txt');
    expect(downloaded.textContent).toBe('hello world');
  });
});

describe('StreamingHandle', () => {
  it('accepts tool status with all fields', () => {
    const handle: StreamingHandle = {
      update(_text: string): void {},
      finalize(_text: string): void {},
      updateToolStatus(info: {
        toolName: string;
        status: 'running' | 'complete' | 'error';
        elapsedMs?: number;
      }): void {
        expect(info.toolName).toBe('Read');
        expect(info.status).toBe('complete');
        expect(info.elapsedMs).toBe(150);
      },
      abort(): void {},
      delete(): void {},
    };

    handle.updateToolStatus({
      toolName: 'Read',
      status: 'complete',
      elapsedMs: 150,
    });
  });
});

describe('CardAction', () => {
  it('creates a card action with value', () => {
    const action: CardAction = {
      chatId: 'chat-001',
      messageId: 'msg-001',
      action: 'approve',
      value: { reason: 'looks correct' },
    };

    expect(action.chatId).toBe('chat-001');
    expect(action.action).toBe('approve');
    expect(action.value).toEqual({ reason: 'looks correct' });
  });

  it('creates a card action without value', () => {
    const action: CardAction = {
      chatId: 'chat-001',
      messageId: 'msg-001',
      action: 'dismiss',
    };

    expect(action.value).toBeUndefined();
  });
});
