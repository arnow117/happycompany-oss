/**
 * DingTalk quoted/replied message parser.
 *
 * Ported from happycompany's dingtalk-reply-parser.ts.
 * Pure functions for testability.
 */

export interface RepliedMsgContent {
  fileName?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  spaceId?: string;
  fileId?: string;
  text?: string;
}

export interface RepliedMsg {
  createdAt?: number;
  senderId?: string;
  msgType: string;
  msgId?: string;
  content?: RepliedMsgContent | string;
}

export type ExtractedReplyKind = 'file' | 'picture' | 'text' | 'other';

export interface ExtractedReply {
  kind: ExtractedReplyKind;
  originalMsgId?: string;
  fileName?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  textContent?: string;
}

const MAX_REPLIED_SUMMARY = 500;

/**
 * Parse a DingTalk text.repliedMsg block into a normalized shape.
 * Returns null if no reply metadata is present.
 */
export function extractRepliedMsg(
  repliedMsg: RepliedMsg | undefined,
  originalMsgId?: string,
): ExtractedReply | null {
  if (!repliedMsg || !repliedMsg.msgType) {
    return null;
  }

  const content = repliedMsg.content;
  const base = { originalMsgId: originalMsgId ?? repliedMsg.msgId };

  switch (repliedMsg.msgType) {
    case 'file': {
      if (typeof content === 'object' && content) {
        return {
          ...base,
          kind: 'file',
          fileName: content.fileName || 'file',
          downloadCode: content.downloadCode,
        };
      }
      return { ...base, kind: 'file', fileName: 'file' };
    }

    case 'picture': {
      if (typeof content === 'object' && content) {
        return {
          ...base,
          kind: 'picture',
          downloadCode: content.downloadCode,
          pictureDownloadCode: content.pictureDownloadCode,
        };
      }
      return { ...base, kind: 'picture' };
    }

    case 'text': {
      const text =
        typeof content === 'string'
          ? content
          : content && typeof content === 'object'
            ? (content as RepliedMsgContent).text
            : undefined;
      return {
        ...base,
        kind: 'text',
        textContent: text ? text.slice(0, MAX_REPLIED_SUMMARY) : undefined,
      };
    }

    default: {
      const summary =
        typeof content === 'string'
          ? content
          : JSON.stringify(content ?? {});
      return {
        ...base,
        kind: 'other',
        textContent: summary.slice(0, MAX_REPLIED_SUMMARY),
      };
    }
  }
}
