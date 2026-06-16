import { describe, it, expect } from 'vitest';
import {
  feishuMessageEventSchema,
  feishuCardActionSchema,
  dingtalkRobotMessageSchema,
} from '../src/schemas.js';
import { parseFeishuMessageEvent } from '../src/feishu.js';

// ---------------------------------------------------------------------------
// Feishu message event schema
// ---------------------------------------------------------------------------

describe('feishuMessageEventSchema', () => {
  const validTextEvent = {
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

  it('accepts a valid text message event with JSON string content', () => {
    const result = feishuMessageEventSchema.safeParse(validTextEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message.chat_id).toBe('oc_chat001');
      expect(result.data.message.message_id).toBe('om_msg001');
      expect(result.data.message.message_type).toBe('text');
      // content should be parsed from JSON string to object
      expect(typeof result.data.message.content).toBe('object');
    }
  });

  it('accepts content as a pre-parsed object', () => {
    const event = {
      message: {
        chat_id: 'oc_chat002',
        message_id: 'om_msg002',
        message_type: 'text',
        content: { text: 'already parsed' },
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts a file message event', () => {
    const event = {
      message: {
        chat_id: 'oc_chat003',
        message_id: 'om_msg003',
        message_type: 'file',
        content: JSON.stringify({ file_key: 'fk_abc', file_name: 'report.pdf' }),
      },
      sender: { sender_id: { open_id: 'ou_user001' } },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts an image message event', () => {
    const event = {
      message: {
        chat_id: 'oc_chat004',
        message_id: 'om_msg004',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_xyz' }),
      },
      sender: { sender_id: { open_id: 'ou_user001' } },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts missing sender field', () => {
    const event = {
      message: {
        chat_id: 'oc_chat005',
        message_id: 'om_msg005',
        message_type: 'text',
        content: JSON.stringify({ text: 'no sender' }),
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sender).toEqual({});
    }
  });

  it('accepts empty sender_id', () => {
    const event = {
      message: {
        chat_id: 'oc_chat006',
        message_id: 'om_msg006',
        message_type: 'text',
        content: JSON.stringify({ text: 'empty sender_id' }),
      },
      sender: { sender_id: {} },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sender?.sender_id?.open_id).toBeUndefined();
    }
  });

  it('rejects missing message field', () => {
    const event = {
      sender: { sender_id: { open_id: 'ou_user001' } },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects missing chat_id', () => {
    const event = {
      message: {
        message_id: 'om_msg007',
        message_type: 'text',
        content: JSON.stringify({ text: 'test' }),
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects missing message_id', () => {
    const event = {
      message: {
        chat_id: 'oc_chat008',
        message_type: 'text',
        content: JSON.stringify({ text: 'test' }),
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects invalid JSON string in content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat009',
        message_id: 'om_msg009',
        message_type: 'text',
        content: 'not valid json {{{',
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects non-string and non-object content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat010',
        message_id: 'om_msg010',
        message_type: 'text',
        content: 42,
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = feishuMessageEventSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects completely wrong type (string)', () => {
    const result = feishuMessageEventSchema.safeParse('not an object');
    expect(result.success).toBe(false);
  });

  it('handles unicode content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat011',
        message_id: 'om_msg011',
        message_type: 'text',
        content: JSON.stringify({ text: '你好世界' }),
      },
      sender: { sender_id: { open_id: 'ou_user001' } },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.message.content as { text: string }).text).toBe('你好世界');
    }
  });

  it('handles empty object content', () => {
    const event = {
      message: {
        chat_id: 'oc_chat012',
        message_id: 'om_msg012',
        message_type: 'image',
        content: '{}',
      },
    };
    const result = feishuMessageEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feishu card action schema
// ---------------------------------------------------------------------------

describe('feishuCardActionSchema', () => {
  it('accepts a valid card action with value and context', () => {
    const event = {
      action: { value: { action: 'approve', reason: 'ok' } },
      context: { open_message_id: 'om_msg001', open_chat_id: 'oc_chat001' },
    };
    const result = feishuCardActionSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context?.open_message_id).toBe('om_msg001');
      expect(result.data.context?.open_chat_id).toBe('oc_chat001');
      expect(result.data.action?.value?.action).toBe('approve');
    }
  });

  it('accepts missing action and context', () => {
    const result = feishuCardActionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toEqual({});
      expect(result.data.context).toEqual({});
    }
  });

  it('accepts empty action value', () => {
    const event = {
      action: {},
      context: { open_message_id: 'om_msg002', open_chat_id: 'oc_chat002' },
    };
    const result = feishuCardActionSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts action with no value', () => {
    const event = {
      action: {},
      context: {},
    };
    const result = feishuCardActionSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = feishuCardActionSchema.safeParse('string');
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = feishuCardActionSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DingTalk robot message schema
// ---------------------------------------------------------------------------

describe('dingtalkRobotMessageSchema', () => {
  const validTextMessage = {
    conversationId: 'cid001',
    msgId: 'msg001',
    msgtype: 'text',
    conversationType: '1',
    senderId: 'user001',
    senderNick: 'Alice',
    text: { content: 'hello world' },
  };

  it('accepts a valid text message', () => {
    const result = dingtalkRobotMessageSchema.safeParse(validTextMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBe('cid001');
      expect(result.data.msgId).toBe('msg001');
      expect(result.data.msgtype).toBe('text');
      expect(result.data.text?.content).toBe('hello world');
    }
  });

  it('accepts a text message with reply', () => {
    const message = {
      ...validTextMessage,
      originalMsgId: 'orig001',
      text: {
        content: 'reply text',
        isReplyMsg: true,
        repliedMsg: {
          msgType: 'text',
          msgId: 'orig001',
          content: 'original text',
        },
      },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text?.isReplyMsg).toBe(true);
      expect(result.data.text?.repliedMsg?.msgType).toBe('text');
    }
  });

  it('accepts a richText message', () => {
    const message = {
      conversationId: 'cid002',
      msgId: 'msg002',
      msgtype: 'richText',
      content: {
        richText: [
          { text: 'hello ', type: 'text' },
          { text: 'world', type: 'text' },
        ],
      },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content?.richText).toHaveLength(2);
    }
  });

  it('accepts a picture message', () => {
    const message = {
      conversationId: 'cid003',
      msgId: 'msg003',
      msgtype: 'picture',
      content: {
        pictureDownloadCode: 'pic_code_001',
      },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content?.pictureDownloadCode).toBe('pic_code_001');
    }
  });

  it('accepts a file message', () => {
    const message = {
      conversationId: 'cid004',
      msgId: 'msg004',
      msgtype: 'file',
      content: {
        downloadCode: 'dl_code_001',
        fileName: 'report.pdf',
        fileSize: 102400,
      },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content?.fileName).toBe('report.pdf');
      expect(result.data.content?.fileSize).toBe(102400);
    }
  });

  it('accepts an image message', () => {
    const message = {
      conversationId: 'cid005',
      msgId: 'msg005',
      msgtype: 'image',
      image: { contentUrl: 'https://example.com/img.png' },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image?.contentUrl).toBe('https://example.com/img.png');
    }
  });

  it('accepts minimal required fields only', () => {
    const message = {
      conversationId: 'cid006',
      msgId: 'msg006',
      msgtype: 'text',
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('accepts group conversation with sessionWebhook', () => {
    const message = {
      conversationId: 'cid007',
      msgId: 'msg007',
      msgtype: 'text',
      conversationType: '2',
      senderId: 'user002',
      senderStaffId: 'staff001',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/send?session=abc',
      sessionWebhookExpiredTime: 3600000,
      text: { content: 'group message' },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionWebhook).toBe(
        'https://oapi.dingtalk.com/robot/send?session=abc',
      );
      expect(result.data.senderStaffId).toBe('staff001');
    }
  });

  it('rejects missing conversationId', () => {
    const message = { msgId: 'msg008', msgtype: 'text' };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('rejects missing msgId', () => {
    const message = { conversationId: 'cid008', msgtype: 'text' };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('rejects missing msgtype', () => {
    const message = { conversationId: 'cid009', msgId: 'msg009' };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('rejects non-string conversationId', () => {
    const message = { conversationId: 123, msgId: 'msg010', msgtype: 'text' };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = dingtalkRobotMessageSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects non-object input', () => {
    const result = dingtalkRobotMessageSchema.safeParse('not an object');
    expect(result.success).toBe(false);
  });

  it('ignores unknown extra fields', () => {
    const message = {
      conversationId: 'cid010',
      msgId: 'msg010',
      msgtype: 'text',
      unknownField: 'should be stripped',
      text: { content: 'test' },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    // unknown fields are stripped by z.object strictness
  });

  it('accepts content with downloadCode for file downloads', () => {
    const message = {
      conversationId: 'cid011',
      msgId: 'msg011',
      msgtype: 'file',
      content: {
        downloadCode: 'dl_abc',
        fileName: 'data.csv',
      },
    };
    const result = dingtalkRobotMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content?.downloadCode).toBe('dl_abc');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: schemas + parseFeishuMessageEvent
// ---------------------------------------------------------------------------

describe('schema integration with parseFeishuMessageEvent', () => {
  it('schema-validated data is accepted by parseFeishuMessageEvent', () => {
    const event = {
      message: {
        chat_id: 'oc_int001',
        message_id: 'om_int001',
        message_type: 'text',
        content: JSON.stringify({ text: 'integration test' }),
      },
      sender: { sender_id: { open_id: 'ou_user001' } },
    };

    // Validate through schema first
    const validated = feishuMessageEventSchema.parse(event);

    // Then pass to parser
    const msg = parseFeishuMessageEvent(validated, 'ou_bot_id');
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('integration test');
    expect(msg!.chatId).toBe('oc_int001');
  });

  it('parseFeishuMessageEvent returns null for schema-invalid data', () => {
    // Missing message_id — schema will reject
    const invalid = {
      message: {
        chat_id: 'oc_int002',
        message_type: 'text',
        content: JSON.stringify({ text: 'bad' }),
      },
    };

    const msg = parseFeishuMessageEvent(invalid, 'ou_bot_id');
    expect(msg).toBeNull();
  });
});
