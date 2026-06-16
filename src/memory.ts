import { mkdirSync, existsSync, appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { logger } from './logger.js';

const MAX_APPEND_SIZE = 16 * 1024;   // 16KB per append
const MAX_FILE_SIZE = 512 * 1024;    // 512KB per file
const MAX_SEARCH_RESULTS = 50;
const MAX_READ_LINES = 200;

export class MemoryManager {
  private readonly defaultRoot: string;
  private readonly subjectDirResolver?: (subject: string, tenant?: string) => string | undefined;

  constructor(
    dataDir: string,
    options: { subjectDirResolver?: (subject: string, tenant?: string) => string | undefined } = {},
  ) {
    this.defaultRoot = resolve(dataDir, 'agents');
    this.subjectDirResolver = options.subjectDirResolver;
    mkdirSync(this.defaultRoot, { recursive: true });
  }

  private subjectRoot(subject: string, tenant?: string): string {
    const resolved = this.subjectDirResolver?.(subject, tenant);
    if (resolved) return resolve(resolved);
    const safeSubject = subject.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return join(this.defaultRoot, safeSubject);
  }

  private memoryDir(subject: string, tenant?: string): string {
    const dir = join(this.subjectRoot(subject, tenant), 'memory');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  appendMemory(botName: string, content: string, date?: string, tenant?: string): void {
    if (Buffer.byteLength(content, 'utf-8') > MAX_APPEND_SIZE) {
      throw new Error(`Content too large: ${Buffer.byteLength(content, 'utf-8')} bytes (max ${MAX_APPEND_SIZE})`);
    }

    const d = date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(`Invalid date format: ${d}, expected YYYY-MM-DD`);
    }

    const filePath = join(this.memoryDir(botName, tenant), `${d}.md`);

    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`Memory file too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);
      }
    }

    const timestamp = new Date().toISOString();
    const separator = `\n---\n> ${timestamp}\n\n`;
    appendFileSync(filePath, separator + content + '\n', 'utf-8');
    logger.info({ botName, date: d, size: Buffer.byteLength(content, 'utf-8') }, 'Memory appended');
  }

  searchMemory(botName: string, query: string, maxResults: number = MAX_SEARCH_RESULTS, tenant?: string): Array<{ file: string; line: number; context: string }> {
    const dir = this.memoryDir(botName, tenant);
    if (!existsSync(dir)) return [];

    const results: Array<{ file: string; line: number; context: string }> = [];

    try {
      const files = this.collectFiles(dir);
      for (const file of files) {
        if (results.length >= maxResults) break;
        try {
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              const context = lines.slice(start, end).join('\n');
              results.push({ file: file.slice(dir.length + 1), line: i + 1, context });
              if (results.length >= maxResults) break;
            }
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* dir may not exist */ }

    return results;
  }

  readMemory(botName: string, file: string, fromLine?: number, lines?: number, tenant?: string): string {
    const dir = this.memoryDir(botName, tenant);
    const filePath = resolve(dir, file);

    if (!isInsideDir(dir, filePath)) {
      throw new Error(`Path traversal blocked: ${file}`);
    }

    if (!existsSync(filePath)) {
      throw new Error(`Memory file not found: ${file}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');

    const start = fromLine ? Math.max(0, fromLine - 1) : 0;
    const count = Math.min(lines ?? MAX_READ_LINES, allLines.length - start);

    return allLines.slice(start, start + count).join('\n');
  }

  listSources(botName: string, tenant?: string): Array<{ file: string; type: string; size: number }> {
    const dir = this.memoryDir(botName, tenant);
    if (!existsSync(dir)) return [];

    const sources: Array<{ file: string; type: string; size: number }> = [];
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        const type = file.endsWith('.md') ? 'date' : 'note';
        sources.push({ file, type, size: stat.size });
      }
    } catch { /* ignore */ }

    return sources.sort((a, b) => b.file.localeCompare(a.file));
  }

  writeMemory(botName: string, file: string, content: string, tenant?: string): void {
    const dir = this.memoryDir(botName, tenant);
    const filePath = resolve(dir, file);

    if (!isInsideDir(dir, filePath)) {
      throw new Error(`Path traversal blocked: ${file}`);
    }

    if (!file.endsWith('.md') && !file.endsWith('.txt')) {
      throw new Error('Only .md and .txt files are allowed');
    }

    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    logger.info({ botName, file, size: content.length }, 'Memory written');
  }

  private collectFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (['node_modules', '.git', '.claude', 'logs'].includes(entry.name)) continue;
          files.push(...this.collectFiles(join(dir, entry.name)));
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
          const stat = statSync(join(dir, entry.name));
          if (stat.size <= MAX_FILE_SIZE) {
            files.push(join(dir, entry.name));
          }
        }
      }
    } catch {
      return [];
    }
    return files;
  }
}

function isInsideDir(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
}
