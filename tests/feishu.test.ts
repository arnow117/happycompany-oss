import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFeishuMessageEvent, buildReplyContent } from '../src/feishu.js';
import type { NormalizedMessage } from '../src/types.js';

describe('parseFeishuMessageEvent', () => {
  const botOpenId = 'ou_abc123';

  it('parses a valid text message event', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg001',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello world' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    expect(msg).not.toBeNull();
    expect(msg!.id).toBe('om_msg001');
    expect(msg!.chatId).toBe('oc_chat001');
    expect(msg!.text).toBe('hello world');
    expect(msg!.source).toBe('user');
    expect(msg!.channelId).toBe('feishu');
    expect(msg!.fromBotName).toBeUndefined();
    expect(msg!.fromUserId).toBe('ou_user001');
    expect(msg!.receivedAt).toBe(now);

    vi.useRealTimers();
  });

  it('parses fromUserId from sender open_id', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg001',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user789' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.fromUserId).toBe('ou_user789');
  });

  it('returns null for self-sent messages', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg002',
        message_type: 'text',
        content: JSON.stringify({ text: 'I said this' }),
      },
      sender: {
        sender_id: { open_id: botOpenId },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).toBeNull();
  });

  it('parses image messages with file attachment', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg003',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_xyz' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('');
    expect(msg!.files).toHaveLength(1);
    expect(msg!.files![0]!.type).toBe('image');
    expect(msg!.files![0]!.name).toBe('image');
    expect(msg!.id).toBe('om_msg003');
    expect(msg!.chatId).toBe('oc_chat001');
  });

  it('parses file messages with file attachment', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg004',
        message_type: 'file',
        content: JSON.stringify({ file_key: 'file_xyz' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('[文件: file_xyz]');
    expect(msg!.files).toHaveLength(1);
    expect(msg!.files![0]!.type).toBe('file');
    expect(msg!.files![0]!.name).toBe('');
    expect(msg!.id).toBe('om_msg004');
  });

  it('returns null for text message with missing text field', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg005',
        message_type: 'text',
        content: JSON.stringify({ other: 'value' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    // New parser filters out messages with no text and no attachments
    expect(msg).toBeNull();
  });

  it('returns null for empty text content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg006',
        message_type: 'text',
        content: JSON.stringify({ text: '' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    // Empty text with no attachments is filtered out
    expect(msg).toBeNull();
  });

  it('handles missing sender field (treats as non-self)', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg007',
        message_type: 'text',
        content: JSON.stringify({ text: 'from unknown' }),
      },
      sender: {},
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('from unknown');
    expect(msg!.source).toBe('user');
  });

  it('handles missing sender_id field (treats as non-self)', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg008',
        message_type: 'text',
        content: JSON.stringify({ text: 'no sender_id' }),
      },
      sender: { sender_id: {} },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('no sender_id');
  });

  it('handles unicode and special characters in text', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg009',
        message_type: 'text',
        content: JSON.stringify({ text: '你好世界 🌍 @bot' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('你好世界 🌍 @bot');
  });

  it('handles multiline text content', () => {
    const multiline = 'line1\nline2\nline3';
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg010',
        message_type: 'text',
        content: JSON.stringify({ text: multiline }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe(multiline);
  });
});

describe('parseFeishuMessageEvent - self-message filtering', () => {
  it('filters out messages from the bot itself', () => {
    const botOpenId = 'ou_bot_self';
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg_self',
        message_type: 'text',
        content: JSON.stringify({ text: 'bot speaking' }),
      },
      sender: {
        sender_id: { open_id: 'ou_bot_self' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).toBeNull();
  });

  it('allows messages from a different bot (open_id differs)', () => {
    const botOpenId = 'ou_bot_a';
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg_other_bot',
        message_type: 'text',
        content: JSON.stringify({ text: 'other bot speaking' }),
      },
      sender: {
        sender_id: { open_id: 'ou_bot_b' },
      },
    };

    // In happycompany there is no fan-out, but parsing still works.
    // The message would come through as a 'user' source since it's not self.
    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('other bot speaking');
  });

  it('allows messages with empty sender open_id', () => {
    const botOpenId = 'ou_bot_a';
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_msg_empty_sender',
        message_type: 'text',
        content: JSON.stringify({ text: 'empty sender' }),
      },
      sender: {
        sender_id: { open_id: '' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
  });
});

describe('parseFeishuMessageEvent - file/image handling', () => {
  const botOpenId = 'ou_abc123';

  it('parses file message with file_name from content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_file_001',
        message_type: 'file',
        content: JSON.stringify({ file_key: 'fk_abc', file_name: 'report.pdf' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('[文件: report.pdf]');
    expect(msg!.files).toHaveLength(1);
    expect(msg!.files![0]!.type).toBe('file');
    expect(msg!.files![0]!.name).toBe('report.pdf');
    expect(msg!.files![0]!.localPath).toBe('');
  });

  it('parses file message without file_key as generic fallback', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_file_002',
        message_type: 'file',
        content: JSON.stringify({ file_name: 'doc.txt' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    // No file_key → falls through to generic [messageType] fallback
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('[file]');
    expect(msg!.files).toBeUndefined();
  });

  it('parses image message without image_key as generic fallback', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_img_002',
        message_type: 'image',
        content: JSON.stringify({}),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    // No image_key → falls through to generic [messageType] fallback
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('[image]');
    expect(msg!.files).toBeUndefined();
  });

  it('parses audio messages as voice message text', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_audio_001',
        message_type: 'audio',
        content: JSON.stringify({}),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('[语音消息]');
  });
});

describe('parseFeishuMessageEvent - root_id acceptance', () => {
  const botOpenId = 'ou_abc123';

  it('accepts message with root_id and parses normally', () => {
    const event = {
      message: {
        chat_id: 'oc_chat001',
        message_id: 'om_reply_001',
        message_type: 'text',
        root_id: 'om_parent_001',
        content: JSON.stringify({ text: 'this is a reply' }),
      },
      sender: {
        sender_id: { open_id: 'ou_user001' },
      },
    };

    const msg = parseFeishuMessageEvent(event, botOpenId);
    expect(msg).not.toBeNull();
    expect(msg!.id).toBe('om_reply_001');
    expect(msg!.text).toBe('this is a reply');
    // Pure function cannot fetch parent — replyTo is set by the class method
    expect(msg!.replyTo).toBeUndefined();
  });
});

describe('buildReplyContent', () => {
  it('prepends quoted parent text to user message', () => {
    const result = buildReplyContent('thanks', 'original message');
    expect(result).toBe('> original message\n\nthanks');
  });

  it('handles multiline parent text', () => {
    const parent = 'line one\nline two\nline three';
    const result = buildReplyContent('reply', parent);
    expect(result).toBe('> line one\n> line two\n> line three\n\nreply');
  });

  it('handles empty user text', () => {
    const result = buildReplyContent('', 'parent message');
    expect(result).toBe('> parent message');
  });

  it('handles empty parent text', () => {
    const result = buildReplyContent('hello', '');
    expect(result).toBe('hello');
  });

  it('truncates long parent text to 500 chars', () => {
    const longParent = 'a'.repeat(600);
    const truncated = longParent.slice(0, 500) + '...';
    const result = buildReplyContent('reply', truncated);
    expect(result).toContain('> ' + 'a'.repeat(500));
    expect(result).toContain('...');
    expect(result).toContain('reply');
  });
});
