/**
 * Zod schemas for validating raw webhook payloads at system boundaries.
 *
 * Feishu and DingTalk callbacks deliver opaque JSON that was previously
 * cast with `as` type assertions (P0 security concern). These schemas
 * validate the shape of incoming data before it reaches business logic.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Feishu schemas
// ---------------------------------------------------------------------------

/**
 * Accepts any object with arbitrary keys.
 * Used for loosely-typed sub-structures like Feishu message content.
 */
const looseObj = z.looseObject({});

/**
 * Accepts a JSON string or a pre-parsed object, normalizing to an object.
 */
const jsonStringOrObject = z.union([
  looseObj,
  z.string().transform((s, ctx) => {
    try {
      return JSON.parse(s);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content is not valid JSON',
      });
      return z.NEVER;
    }
  }),
]);

/**
 * The `message` object inside a Feishu `im.message.receive_v1` event.
 */
const feishuMessageSchema = z.object({
  chat_id: z.string(),
  message_id: z.string(),
  message_type: z.string(),
  root_id: z.string().optional(),
  parent_id: z.string().optional(),
  thread_id: z.string().optional(),
  create_time: z.string().optional(),
  chat_type: z.string().optional(),
  mentions: z.array(z.object({
    key: z.string().optional(),
    name: z.string().optional(),
    id: z.object({ open_id: z.string().optional() }).optional(),
  })).optional(),
  content: jsonStringOrObject,
});

/**
 * Schema for a Feishu `im.message.receive_v1` event payload.
 * Validated at the boundary where the Lark SDK delivers raw data.
 */
export const feishuMessageEventSchema = z.object({
  message: feishuMessageSchema,
  sender: z
    .object({
      sender_id: z
        .object({
          open_id: z.string().optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
});

/**
 * Schema for a Feishu `card.action.trigger` event payload.
 */
export const feishuCardActionSchema = z.object({
  action: z
    .object({
      value: looseObj.optional(),
    })
    .optional()
    .default({}),
  context: z
    .object({
      open_message_id: z.string().optional(),
      open_chat_id: z.string().optional(),
    })
    .optional()
    .default({}),
});

export type FeishuMessageEventInput = z.input<typeof feishuMessageEventSchema>;
export type FeishuMessageEvent = z.infer<typeof feishuMessageEventSchema>;
export type FeishuCardActionInput = z.input<typeof feishuCardActionSchema>;
export type FeishuCardAction = z.infer<typeof feishuCardActionSchema>;

// ---------------------------------------------------------------------------
// DingTalk schemas
// ---------------------------------------------------------------------------

/**
 * Schema for a DingTalk robot message callback payload.
 * The `content` field in richText messages is loosely typed because
 * the shape depends on msgtype.
 */
export const dingtalkRobotMessageSchema = z.object({
  conversationId: z.string(),
  msgId: z.string(),
  msgtype: z.string(),
  conversationType: z.string().optional(),
  senderId: z.string().optional(),
  senderNick: z.string().optional(),
  senderStaffId: z.string().optional(),
  sessionWebhook: z.string().optional(),
  originalMsgId: z.string().optional(),
  robotCode: z.string().optional(),
  isAdmin: z.boolean().optional(),
  createAt: z.number().optional(),
  sessionWebhookExpiredTime: z.number().optional(),
  senderCorpId: z.string().optional(),
  chatbotCorpId: z.string().optional(),
  chatbotUserId: z.string().optional(),
  text: z
    .object({
      content: z.string().optional(),
      isReplyMsg: z.boolean().optional(),
      repliedMsg: z
        .object({
          msgType: z.string().optional(),
          msgId: z.string().optional(),
          senderId: z.string().optional(),
          createdAt: z.number().optional(),
          content: z.unknown().optional(),
        })
        .optional(),
    })
    .optional(),
  image: z
    .object({
      contentUrl: z.string().optional(),
    })
    .optional(),
  content: z
    .object({
      richText: z
        .array(
          z.object({
            text: z.string().optional(),
            type: z.string().optional(),
            downloadCode: z.string().optional(),
            pictureDownloadCode: z.string().optional(),
          }),
        )
        .optional(),
      downloadCode: z.string().optional(),
      pictureDownloadCode: z.string().optional(),
      fileName: z.string().optional(),
      fileSize: z.number().optional(),
    })
    .optional(),
});

export type DingTalkRobotMessageInput = z.input<typeof dingtalkRobotMessageSchema>;
export type DingTalkRobotMessage = z.infer<typeof dingtalkRobotMessageSchema>;
