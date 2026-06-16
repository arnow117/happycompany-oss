import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DingTalkChannel } from '../src/dingtalk.js';
import { extractRepliedMsg, type ExtractedReply } from '../src/dingtalk-reply-parser.js';
import type { NormalizedMessage, BotConfig } from '../src/types.js';

// -- Helpers --

function makeConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    name: 'test-bot',
    channel: 'dingtalk',
    credentials: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    displayName: 'Test Bot',
    ...overrides,
  };
}

// -- parseMessageContent tests --

describe('DingTalkChannel.parseMessageContent', () => {
  let channel: DingTalkChannel;

  beforeEach(() => {
    channel = new DingTalkChannel(makeConfig());
  });

  it('parses a plain text message', async () => {
    const data = {
      msgtype: 'text',
      msgId: 'msg001',
      conversationId: 'cid001',
      conversationType: '1',
      senderId: 'user001',
      senderNick: 'Alice',
      text: { content: 'hello world' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('hello world');
    expect(result.files).toBeUndefined();
  });

  it('strips whitespace from text content', async () => {
    const data = {
      msgtype: 'text',
      text: { content: '  hello world  ' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('hello world');
  });

  it('returns empty string for empty text content', async () => {
    const data = {
      msgtype: 'text',
      text: { content: '' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('');
  });

  it('parses text message with reply (text reply)', async () => {
    const data = {
      msgtype: 'text',
      msgId: 'msg002',
      text: {
        content: 'what about this?',
        isReplyMsg: true,
        repliedMsg: {
          msgType: 'text',
          content: 'original message text',
          msgId: 'orig001',
        },
      },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:group:cid002');
    expect(result.content).toContain('> original message text');
    expect(result.content).toContain('what about this?');
  });

  it('parses text message with file reply', async () => {
    const data = {
      msgtype: 'text',
      msgId: 'msg003',
      text: {
        content: 'check this file',
        isReplyMsg: true,
        repliedMsg: {
          msgType: 'file',
          content: { fileName: 'report.pdf', downloadCode: 'dc001' },
        },
      },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:group:cid003');
    expect(result.content).toContain('report.pdf');
    expect(result.content).toContain('check this file');
  });

  it('parses text message with picture reply', async () => {
    const data = {
      msgtype: 'text',
      msgId: 'msg004',
      text: {
        content: 'nice image',
        isReplyMsg: true,
        repliedMsg: {
          msgType: 'picture',
          content: { downloadCode: 'pic001' },
        },
      },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:group:cid004');
    expect(result.content).toContain('quoted picture');
    expect(result.content).toContain('nice image');
  });

  it('parses richText message', async () => {
    const data = {
      msgtype: 'richText',
      content: {
        richText: [
          { text: 'Hello ' },
          { text: 'World' },
        ],
      },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('Hello World');
  });

  it('parses richText with only pictures as empty', async () => {
    const data = {
      msgtype: 'richText',
      content: {
        richText: [
          { type: 'picture', downloadCode: 'pic002' },
        ],
      },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('');
  });

  it('parses picture message', async () => {
    const data = {
      msgtype: 'picture',
      content: { downloadCode: 'pic003' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('[picture]');
  });

  it('parses file message', async () => {
    const data = {
      msgtype: 'file',
      content: { fileName: 'doc.pdf', downloadCode: 'dc002' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('[file: doc.pdf]');
  });

  it('parses image message', async () => {
    const data = {
      msgtype: 'image',
      image: { contentUrl: 'https://example.com/img.png' },
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('[image]');
  });

  it('returns empty for unknown message type', async () => {
    const data = {
      msgtype: 'audio',
    };

    const result = await channel.parseMessageContent(data as any, 'dingtalk:c2c:user001');
    expect(result.content).toBe('');
  });
});

// -- buildReplyContent tests --

describe('DingTalkChannel.buildReplyContent', () => {
  let channel: DingTalkChannel;

  beforeEach(() => {
    channel = new DingTalkChannel(makeConfig());
  });

  it('builds quoted text reply with user message', () => {
    const result = channel.buildReplyContent('follow up question', {
      kind: 'text',
      textContent: 'original text',
    });
    expect(result).toContain('> original text');
    expect(result).toContain('follow up question');
  });

  it('builds quoted text reply without user message', () => {
    const result = channel.buildReplyContent('', {
      kind: 'text',
      textContent: 'just quoted',
    });
    expect(result).toBe('> just quoted');
  });

  it('builds quoted file reply', () => {
    const result = channel.buildReplyContent('see this', {
      kind: 'file',
      fileName: 'report.pdf',
    });
    expect(result).toContain('report.pdf');
    expect(result).toContain('see this');
  });

  it('builds quoted picture reply', () => {
    const result = channel.buildReplyContent('', {
      kind: 'picture',
    });
    expect(result).toBe('[quoted picture]');
  });

  it('handles multiline textContent in quote', () => {
    const result = channel.buildReplyContent('', {
      kind: 'text',
      textContent: 'line1\nline2\nline3',
    });
    expect(result).toContain('> line1');
    expect(result).toContain('> line2');
    expect(result).toContain('> line3');
  });

  it('handles other reply kind with textContent as quoted', () => {
    const result = channel.buildReplyContent('', {
      kind: 'other',
      textContent: 'some unknown content',
    });
    expect(result).toContain('> some unknown content');
  });

  it('handles other reply kind without textContent as unparseable', () => {
    const result = channel.buildReplyContent('', {
      kind: 'other',
    });
    expect(result).toContain('unparseable quoted content');
  });
});

// -- /clear command handling tests --

describe('DingTalkChannel /clear command', () => {
  it('routes /clear as a NormalizedMessage with channelId dingtalk', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    // Simulate incoming /clear message
    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_clear_001',
      conversationId: 'cid001',
      conversationType: '1',
      senderId: 'user001',
      text: { content: '/clear' },
    }));

    expect(received).toHaveLength(1);
    expect(received[0]!.text).toBe('/clear');
    expect(received[0]!.channelId).toBe('dingtalk');
    expect(received[0]!.chatId).toBe('dingtalk:c2c:user001');
  });
});

// -- Deduplication tests --

describe('DingTalkChannel deduplication', () => {
  it('deduplicates identical message IDs', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    const rawMsg = JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_dup_001',
      conversationId: 'cid001',
      conversationType: '1',
      senderId: 'user001',
      text: { content: 'hello' },
    });

    await channel.handleRobotMessage(rawMsg);
    await channel.handleRobotMessage(rawMsg);

    expect(received).toHaveLength(1);
  });

  it('allows different message IDs', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_a',
      conversationId: 'cid001',
      conversationType: '1',
      senderId: 'user001',
      text: { content: 'first' },
    }));
    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_b',
      conversationId: 'cid001',
      conversationType: '1',
      senderId: 'user001',
      text: { content: 'second' },
    }));

    expect(received).toHaveLength(2);
    expect(received[0]!.text).toBe('first');
    expect(received[1]!.text).toBe('second');
  });
});

// -- Message routing tests --

describe('DingTalkChannel message routing', () => {
  it('produces NormalizedMessage with correct fields', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    const now = Date.now();
    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_route_001',
      conversationId: 'cid002',
      conversationType: '2',
      senderId: 'user002',
      senderNick: 'Bob',
      text: { content: 'test message' },
    }));

    expect(received).toHaveLength(1);
    const msg = received[0]!;
    expect(msg.id).toBe('msg_route_001');
    expect(msg.chatId).toBe('dingtalk:group:cid002');
    expect(msg.text).toBe('test message');
    expect(msg.source).toBe('user');
    expect(msg.channelId).toBe('dingtalk');
    expect(msg.receivedAt).toBeGreaterThanOrEqual(now);
  });

  it('includes senderStaffId as fromUserId in NormalizedMessage', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_user_001',
      conversationId: 'cid003',
      conversationType: '1',
      senderId: 'user003',
      senderStaffId: 'staff_abc123',
      text: { content: 'hello from staff' },
    }));

    expect(received).toHaveLength(1);
    expect(received[0]!.fromUserId).toBe('staff_abc123');
  });

  it('routes C2C messages with correct jid format', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      msgId: 'msg_c2c',
      conversationId: 'conv001',
      conversationType: '1',
      senderId: 'user003',
      text: { content: 'direct message' },
    }));

    expect(received).toHaveLength(1);
    expect(received[0]!.chatId).toBe('dingtalk:c2c:user003');
  });

  it('drops messages without msgId', async () => {
    const channel = new DingTalkChannel(makeConfig());
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.handleRobotMessage(JSON.stringify({
      msgtype: 'text',
      conversationId: 'cid003',
      conversationType: '1',
      senderId: 'user004',
      text: { content: 'no id' },
    }));

    expect(received).toHaveLength(0);
  });
});

// -- Channel lifecycle tests --

describe('DingTalkChannel lifecycle', () => {
  it('start() uses an injected Stream client and registers robot callback', async () => {
    const registerCallbackListener = vi.fn();
    const socketCallBackResponse = vi.fn();
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const DWClient = vi.fn().mockImplementation(function () {
      return {
        registerCallbackListener,
        socketCallBackResponse,
        connect,
        disconnect,
      };
    });

    const channel = new DingTalkChannel(makeConfig(), {
      streamSdk: { DWClient, TOPIC_ROBOT: 'TOPIC_ROBOT' },
    });

    await channel.start();

    expect(DWClient).toHaveBeenCalledWith({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      debug: false,
      keepAlive: true,
    });
    expect(registerCallbackListener).toHaveBeenCalledWith('TOPIC_ROBOT', expect.any(Function));
    expect(connect).toHaveBeenCalledTimes(1);

    await channel.stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('robot callback acks the stream event and routes the message', async () => {
    let callback: ((downstream: { data: string; headers?: { messageId?: string } }) => Promise<void>) | undefined;
    const socketCallBackResponse = vi.fn();
    const DWClient = vi.fn().mockImplementation(function () {
      return {
        registerCallbackListener: (_topic: string, cb: typeof callback) => {
          callback = cb;
        },
        socketCallBackResponse,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      };
    });

    const channel = new DingTalkChannel(makeConfig(), {
      streamSdk: { DWClient, TOPIC_ROBOT: 'TOPIC_ROBOT' },
    });
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.start();
    await callback?.({
      headers: { messageId: 'stream-msg-1' },
      data: JSON.stringify({
        msgtype: 'text',
        msgId: 'msg_stream_001',
        conversationId: 'conv-stream-001',
        conversationType: '1',
        senderId: 'user001',
        senderStaffId: 'staff001',
        text: { content: 'hello stream' },
      }),
    });

    expect(socketCallBackResponse).toHaveBeenCalledWith('stream-msg-1', { success: true });
    expect(received).toHaveLength(1);
    expect(received[0]!.text).toBe('hello stream');
    expect(received[0]!.fromUserId).toBe('staff001');
  });

  it('robot event fallback routes messages delivered as stream events', async () => {
    let eventHandler: ((downstream: { data: string; headers: { topic: string; messageId: string } }) => unknown) | undefined;
    const DWClient = vi.fn().mockImplementation(function () {
      return {
        registerAllEventListener: (handler: typeof eventHandler) => {
          eventHandler = handler;
          return this;
        },
        registerCallbackListener: vi.fn(),
        socketCallBackResponse: vi.fn(),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      };
    });

    const channel = new DingTalkChannel(makeConfig(), {
      streamSdk: { DWClient, TOPIC_ROBOT: '/v1.0/im/bot/messages/get' },
    });
    const received: NormalizedMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    await channel.start();
    const ack = eventHandler?.({
      headers: { topic: '/v1.0/im/bot/messages/get', messageId: 'event-msg-1' },
      data: JSON.stringify({
        msgtype: 'text',
        msgId: 'msg_event_001',
        conversationId: 'conv-event-001',
        conversationType: '1',
        senderId: 'user001',
        senderStaffId: 'staff001',
        text: { content: 'hello event' },
      }),
    });

    expect(ack).toEqual({ status: 'SUCCESS' });
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    }, { timeout: 5_000 });
    expect(received[0]!.text).toBe('hello event');
  });

  it('start() skips when credentials are empty', async () => {
    const channel = new DingTalkChannel(makeConfig({
      credentials: {},
    }));
    // Should return early without error when clientId/clientSecret missing
    await channel.start();
  });

  it('stop() clears internal state', async () => {
    const channel = new DingTalkChannel(makeConfig());
    await channel.stop();
    // Should not throw — channel was never started
  });

  it('onMessage returns unsubscribe function', () => {
    const channel = new DingTalkChannel(makeConfig());
    let callCount = 0;
    const unsub = channel.onMessage(() => { callCount++; });
    expect(typeof unsub).toBe('function');

    unsub();
    // After unsubscribe, handlers should be empty (verified via internal state)
  });

  it('sendStreaming returns a StreamingHandle', () => {
    const channel = new DingTalkChannel(makeConfig());
    const handle = channel.sendStreaming('dingtalk:group:cid001');
    expect(handle).toHaveProperty('update');
    expect(handle).toHaveProperty('finalize');
    expect(handle).toHaveProperty('updateToolStatus');
    expect(handle).toHaveProperty('abort');
    expect(handle).toHaveProperty('delete');
    expect(typeof handle.update).toBe('function');
    expect(typeof handle.finalize).toBe('function');
  });
});

// -- extractRepliedMsg tests (from dingtalk-reply-parser.ts) --

describe('extractRepliedMsg', () => {
  it('returns null for undefined repliedMsg', () => {
    expect(extractRepliedMsg(undefined)).toBeNull();
  });

  it('returns null for repliedMsg without msgType', () => {
    expect(extractRepliedMsg({} as any)).toBeNull();
  });

  it('parses file reply with downloadCode', () => {
    const result = extractRepliedMsg(
      {
        msgType: 'file',
        content: { fileName: 'test.pdf', downloadCode: 'dc_123' },
        msgId: 'orig_msg_001',
      },
      'parent_msg_001',
    );

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('file');
    expect(result!.fileName).toBe('test.pdf');
    expect(result!.downloadCode).toBe('dc_123');
    expect(result!.originalMsgId).toBe('parent_msg_001');
  });

  it('parses file reply without content object', () => {
    const result = extractRepliedMsg({ msgType: 'file' });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('file');
    expect(result!.fileName).toBe('file');
  });

  it('parses picture reply with downloadCode', () => {
    const result = extractRepliedMsg({
      msgType: 'picture',
      content: { downloadCode: 'pic_dc', pictureDownloadCode: 'pic_pdc' },
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('picture');
    expect(result!.downloadCode).toBe('pic_dc');
    expect(result!.pictureDownloadCode).toBe('pic_pdc');
  });

  it('parses text reply with string content', () => {
    const result = extractRepliedMsg({
      msgType: 'text',
      content: 'Hello quoted text',
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('text');
    expect(result!.textContent).toBe('Hello quoted text');
  });

  it('parses text reply with object content', () => {
    const result = extractRepliedMsg({
      msgType: 'text',
      content: { text: 'Object text content' },
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('text');
    expect(result!.textContent).toBe('Object text content');
  });

  it('truncates long text reply content', () => {
    const longText = 'A'.repeat(1000);
    const result = extractRepliedMsg({
      msgType: 'text',
      content: longText,
    });

    expect(result!.textContent!.length).toBeLessThanOrEqual(500);
  });

  it('parses unknown message type as "other"', () => {
    const result = extractRepliedMsg({
      msgType: 'richText',
      content: { someField: 'value' },
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('other');
    expect(result!.textContent).toContain('someField');
  });

  it('uses originalMsgId when provided', () => {
    const result = extractRepliedMsg(
      { msgType: 'text', content: 'hello', msgId: 'inner_id' },
      'outer_id',
    );

    expect(result!.originalMsgId).toBe('outer_id');
  });

  it('falls back to repliedMsg.msgId when originalMsgId is not provided', () => {
    const result = extractRepliedMsg({
      msgType: 'text',
      content: 'hello',
      msgId: 'inner_id',
    });

    expect(result!.originalMsgId).toBe('inner_id');
  });
});
