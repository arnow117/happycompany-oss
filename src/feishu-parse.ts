import { logger } from './logger.js';

export interface FeishuFileInfo {
  fileKey: string;
  filename: string;
}

export interface ExtractedContent {
  text: string;
  imageKeys?: string[];
  fileInfos?: FeishuFileInfo[];
}

export function extractMessageContent(
  messageType: string,
  content: string,
): ExtractedContent {
  if (messageType === 'merge_forward') {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { text: '[合并转发消息]' };
    }
    const items = (parsed.message_list ?? parsed.items) as
      | Array<Record<string, unknown>>
      | undefined;
    if (!Array.isArray(items) || items.length === 0) {
      return { text: '[合并转发消息]' };
    }
    const lines: string[] = ['[合并转发消息]:'];
    for (const item of items.slice(0, 20)) {
      const sender =
        (typeof item.sender_name === 'string' && item.sender_name) ||
        (typeof item.sender === 'string' && item.sender) ||
        '未知';
      const body =
        (item.body as Record<string, unknown>)?.content ?? item.content ?? '';
      let text = '';
      try {
        const subType =
          (typeof item.msg_type === 'string' && item.msg_type) ||
          (typeof item.message_type === 'string' && item.message_type) ||
          'text';
        const sub = extractMessageContent(subType, String(body));
        text = sub.text || '';
      } catch {
        text = typeof body === 'string' ? body : '';
      }
      if (text) {
        lines.push(`> ${sender}: ${text.split('\n')[0]!.slice(0, 200)}`);
      }
    }
    if (items.length > 20) {
      lines.push(`> ... 共 ${items.length} 条消息`);
    }
    return { text: lines.join('\n') };
  }

  try {
    const parsed = JSON.parse(content);

    if (messageType === 'text') {
      return { text: parsed.text || '' };
    }

    if (messageType === 'post') {
      return extractPostContent(parsed);
    }

    if (messageType === 'image') {
      const imageKey: string | undefined = parsed.image_key;
      if (imageKey) {
        return { text: '', imageKeys: [imageKey] };
      }
    }

    if (messageType === 'file') {
      const fileKey: string | undefined = parsed.file_key;
      const filename: string = parsed.file_name || '';
      if (fileKey) {
        return {
          text: `[文件: ${filename || fileKey}]`,
          fileInfos: [{ fileKey, filename }],
        };
      }
    }

    if (messageType === 'sticker') {
      const stickerDesc = parsed.description || parsed.sticker_id || '表情包';
      return { text: `[表情包: ${stickerDesc}]` };
    }

    if (messageType === 'audio') {
      const duration = parsed.duration
        ? `${Math.round(parsed.duration / 1000)}s`
        : '';
      return { text: `[语音消息${duration ? ': ' + duration : ''}]` };
    }

    if (messageType === 'share_chat') {
      const chatName = parsed.chat_name || parsed.chat_id || '未知群聊';
      return { text: `[分享群聊: ${chatName}]` };
    }

    if (messageType === 'share_user') {
      const userName = parsed.user_name || parsed.user_id || '未知用户';
      return { text: `[分享用户: ${userName}]` };
    }

    if (messageType === 'system') {
      const body = parsed.body || parsed.content || '';
      const systemText =
        typeof body === 'string' ? body : JSON.stringify(body);
      return { text: `[系统消息: ${systemText.slice(0, 200)}]` };
    }

    if (messageType === 'interactive') {
      return extractCardContent(parsed);
    }

    if (messageType === 'media') {
      return { text: '[视频消息]' };
    }

    if (messageType === 'location') {
      return {
        text: `[位置: ${parsed.name || parsed.address || '未知位置'}]`,
      };
    }

    if (messageType === 'share_calendar_event') {
      return {
        text: `[日程分享: ${parsed.summary || parsed.event_id || ''}]`,
      };
    }

    if (messageType === 'video_chat') {
      return { text: `[视频会议: ${parsed.topic || ''}]` };
    }

    if (messageType === 'todo') {
      return {
        text: `[待办: ${parsed.task_id || parsed.summary || ''}]`,
      };
    }

    if (messageType === 'hongbao') {
      return { text: '[红包消息]' };
    }

    return { text: `[${messageType}]` };
  } catch (err) {
    logger.warn(
      { err, messageType, content },
      'Failed to parse message content',
    );
    return { text: `[${messageType}]` };
  }
}

function extractPostContent(
  parsed: Record<string, unknown>,
): ExtractedContent {
  const lines: string[] = [];
  const imageKeys: string[] = [];

  const post = (parsed.post as Record<string, unknown>) || parsed;
  if (!post || typeof post !== 'object') {
    logger.warn(
      { keys: Object.keys(parsed) },
      'Empty post object in post message',
    );
    return { text: '' };
  }

  let contentData: Record<string, unknown> | undefined;
  if (Array.isArray(post.content)) {
    contentData = post as Record<string, unknown>;
  } else {
    const locale =
      (post.zh_cn as Record<string, unknown>) ||
      (post.en_us as Record<string, unknown>) ||
      Object.values(post)[0];
    if (locale && typeof locale === 'object' && Array.isArray((locale as Record<string, unknown>).content)) {
      contentData = locale as Record<string, unknown>;
    }
  }
  if (!contentData || !Array.isArray(contentData.content)) {
    logger.warn(
      { keys: Object.keys(post) },
      'Missing content array in post message',
    );
    return { text: '' };
  }

  if (contentData.title && typeof contentData.title === 'string') {
    lines.push(contentData.title);
  }

  for (const paragraph of contentData.content as Array<unknown>) {
    const segments = Array.isArray(paragraph)
      ? paragraph
      : paragraph && typeof paragraph === 'object'
        ? [paragraph]
        : null;
    if (!segments) continue;
    const parts: string[] = [];
    for (const segment of segments) {
      if (!segment || typeof segment !== 'object') continue;
      const seg = segment as Record<string, unknown>;
      if (seg.tag === 'text' && typeof seg.text === 'string') {
        parts.push(seg.text);
      } else if (seg.tag === 'a' && typeof seg.text === 'string') {
        parts.push(seg.text);
      } else if (seg.tag === 'at') {
        const mentionName =
          typeof seg.user_name === 'string'
            ? seg.user_name
            : typeof seg.text === 'string'
              ? seg.text
              : typeof seg.name === 'string'
                ? seg.name
                : '用户';
        parts.push(`@${mentionName}`);
      } else if (seg.tag === 'img' && typeof seg.image_key === 'string') {
        imageKeys.push(seg.image_key);
        parts.push('[图片]');
      } else if (seg.tag === 'media') {
        parts.push('[视频]');
      } else if (seg.tag === 'emotion' && typeof seg.emoji_type === 'string') {
        parts.push(`:${seg.emoji_type}:`);
      } else if (typeof seg.text === 'string') {
        parts.push(seg.text);
      }
    }
    if (parts.length > 0) lines.push(parts.join(''));
  }

  return {
    text: lines.join('\n'),
    imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
  };
}

function extractCardContent(
  parsed: Record<string, unknown>,
): ExtractedContent {
  const parts: string[] = [];
  if (parsed.title) {
    parts.push(String(parsed.title));
  }
  if (Array.isArray(parsed.elements)) {
    for (const row of parsed.elements) {
      if (!Array.isArray(row)) continue;
      for (const el of row) {
        if (!el || typeof el !== 'object') continue;
        const e = el as Record<string, unknown>;
        if (e.tag === 'text' && typeof e.text === 'string') {
          parts.push(e.text);
        } else if (e.tag === 'a' && typeof e.text === 'string') {
          parts.push(`[${e.text}](${e.href || ''})`);
        } else if (e.tag === 'note' && Array.isArray(e.elements)) {
          const noteText = (e.elements as Array<Record<string, unknown>>)
            .filter(
              (n) => n.tag === 'text' && typeof n.text === 'string',
            )
            .map((n) => n.text)
            .join('');
          if (noteText) parts.push(noteText);
        }
      }
    }
  }
  const cardText = parts.filter(Boolean).join('\n');
  return { text: cardText || '[飞书卡片消息]' };
}
