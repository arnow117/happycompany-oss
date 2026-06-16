import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from './logger.js';
import type { MessageStore } from './store.js';

const ARCHIVE_DIR_NAME = 'conversations';
const MAX_TITLE_LENGTH = 40;
const ARCHIVE_THRESHOLD = 50;

export interface ArchiveRecord {
  file: string;
  title: string;
  botName: string;
  chatId: string;
  messageCount: number;
  createdAt: string;
}

export class ConversationArchiver {
  private readonly archiveBaseDir: string;

  constructor(dataDir: string) {
    this.archiveBaseDir = resolve(dataDir, ARCHIVE_DIR_NAME);
    mkdirSync(this.archiveBaseDir, { recursive: true });
  }

  /**
   * Archive a conversation if it has enough messages.
   * Returns true if archived, false if not enough messages.
   */
  async maybeArchive(
    botName: string,
    chatId: string,
    store: MessageStore,
  ): Promise<boolean> {
    const messages = store.getMessagesForChat(chatId, ARCHIVE_THRESHOLD);
    if (messages.length < ARCHIVE_THRESHOLD) return false;

    const title = this.extractTitle(messages);
    const content = this.formatAsMarkdown(botName, chatId, messages);

    const botDir = join(this.archiveBaseDir, botName);
    mkdirSync(botDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${date}-${title}.md`;
    const filePath = join(botDir, filename);

    writeFileSync(filePath, content, 'utf-8');

    logger.info(
      { botName, chatId, messageCount: messages.length, file: filename },
      'Conversation archived',
    );
    return true;
  }

  listArchives(botName: string): ArchiveRecord[] {
    const botDir = join(this.archiveBaseDir, botName);
    if (!existsSync(botDir)) return [];

    const records: ArchiveRecord[] = [];
    try {
      const files = readdirSync(botDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();
      for (const file of files) {
        const filePath = join(botDir, file);
        const stat = statSync(filePath);
        records.push({
          file,
          title: file
            .replace(/^\d{4}-\d{2}-\d{2}-/, '')
            .replace(/\.md$/, ''),
          botName,
          chatId: '',
          messageCount: 0,
          createdAt: String(stat.mtimeMs),
        });
      }
    } catch {
      /* ignore */
    }

    return records;
  }

  readArchive(botName: string, filename: string): string {
    const filePath = join(this.archiveBaseDir, botName, filename);
    const resolved = resolve(filePath);
    if (!resolved.startsWith(this.archiveBaseDir)) {
      throw new Error('Path traversal blocked');
    }
    return readFileSync(resolved, 'utf-8');
  }

  private extractTitle(
    messages: ReadonlyArray<{ readonly text: string }>,
  ): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messages[i].text.trim();
      if (text.length > 0) {
        const clean = text
          .replace(/[\n\r]/g, ' ')
          .slice(0, MAX_TITLE_LENGTH);
        return clean
          .replace(/[<>:"/\\|?*]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, MAX_TITLE_LENGTH);
      }
    }
    return 'untitled';
  }

  private formatAsMarkdown(
    botName: string,
    chatId: string,
    messages: ReadonlyArray<{
      readonly text: string;
      readonly source: string;
      readonly timestamp: number;
    }>,
  ): string {
    const lines: string[] = [];
    lines.push(`# ${botName} - ${chatId.slice(0, 20)}`);
    lines.push(`> Archived: ${new Date().toISOString()}`);
    lines.push(`> Messages: ${messages.length}`);
    lines.push('');

    for (const msg of messages) {
      const sender = msg.source === 'user' ? 'User' : 'Bot';
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      const text = msg.text.slice(0, 500);
      lines.push(`### ${sender} [${time}]`);
      lines.push('');
      lines.push(text);
      lines.push('');
    }

    return lines.join('\n');
  }
}
