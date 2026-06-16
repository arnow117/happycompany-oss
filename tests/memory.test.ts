import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../src/memory.js';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = '/tmp/happycompany-test-memory';

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new MemoryManager(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  // ── appendMemory ─────────────────────────────────────

  describe('appendMemory', () => {
    it('creates file with date name', () => {
      manager.appendMemory('test-bot', 'Hello memory', '2026-05-03');
      const filePath = join(TEST_DIR, 'agents', 'test-bot', 'memory', '2026-05-03.md');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Hello memory');
    });

    it('uses today date when no date provided', () => {
      manager.appendMemory('test-bot', 'Today entry');
      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(TEST_DIR, 'agents', 'test-bot', 'memory', `${today}.md`);
      expect(existsSync(filePath)).toBe(true);
    });

    it('validates date format', () => {
      expect(() => manager.appendMemory('test-bot', 'content', 'invalid-date')).toThrow(
        'Invalid date format: invalid-date, expected YYYY-MM-DD',
      );
      expect(() => manager.appendMemory('test-bot', 'content', '2026/05/03')).toThrow(
        'Invalid date format: 2026/05/03, expected YYYY-MM-DD',
      );
    });

    it('rejects oversized content', () => {
      const bigContent = 'x'.repeat(16 * 1024 + 1);
      expect(() => manager.appendMemory('test-bot', bigContent, '2026-05-03')).toThrow(
        'Content too large',
      );
    });

    it('rejects oversized file', () => {
      const filePath = join(TEST_DIR, 'agents', 'test-bot', 'memory');
      mkdirSync(filePath, { recursive: true });
      // Create a file that exceeds the limit
      writeFileSync(join(filePath, '2026-05-03.md'), 'x'.repeat(512 * 1024 + 1));
      expect(() => manager.appendMemory('test-bot', 'small content', '2026-05-03')).toThrow(
        'Memory file too large',
      );
    });

    it('appends with separator and timestamp', () => {
      manager.appendMemory('test-bot', 'First entry', '2026-05-03');
      manager.appendMemory('test-bot', 'Second entry', '2026-05-03');
      const content = readFileSync(join(TEST_DIR, 'agents', 'test-bot', 'memory', '2026-05-03.md'), 'utf-8');
      expect(content).toContain('First entry');
      expect(content).toContain('Second entry');
      expect(content).toContain('---');
    });
  });

  // ── searchMemory ─────────────────────────────────────

  describe('searchMemory', () => {
    beforeEach(() => {
      manager.appendMemory('test-bot', 'The quick brown fox jumps over the lazy dog', '2026-05-01');
      manager.appendMemory('test-bot', 'A completely different note about cats', '2026-05-02');
      manager.appendMemory('test-bot', 'Another quick note about programming', '2026-05-03');
    });

    it('finds matching lines', () => {
      const results = manager.searchMemory('test-bot', 'quick');
      expect(results.length).toBe(2);
      expect(results.some(r => r.context.includes('brown fox'))).toBe(true);
      expect(results.some(r => r.context.includes('programming'))).toBe(true);
    });

    it('is case-insensitive', () => {
      const results = manager.searchMemory('test-bot', 'QUICK');
      expect(results.length).toBe(2);
    });

    it('respects maxResults', () => {
      const results = manager.searchMemory('test-bot', 'quick', 1);
      expect(results.length).toBe(1);
    });

    it('returns empty for no matches', () => {
      const results = manager.searchMemory('test-bot', 'xyznonexistent');
      expect(results).toEqual([]);
    });

    it('returns empty for unknown bot', () => {
      const results = manager.searchMemory('unknown-bot', 'quick');
      expect(results).toEqual([]);
    });
  });

  // ── readMemory ───────────────────────────────────────

  describe('readMemory', () => {
    it('returns file content', () => {
      manager.appendMemory('test-bot', 'Line one\nLine two\nLine three', '2026-05-03');
      const content = manager.readMemory('test-bot', '2026-05-03.md');
      expect(content).toContain('Line one');
      expect(content).toContain('Line two');
      expect(content).toContain('Line three');
    });

    it('respects fromLine and lines', () => {
      manager.appendMemory('test-bot', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5', '2026-05-03');
      const content = manager.readMemory('test-bot', '2026-05-03.md', 2, 2);
      const lines = content.split('\n');
      // Should return 2 lines starting from line 2
      expect(lines.length).toBeLessThanOrEqual(2);
    });

    it('blocks path traversal', () => {
      expect(() => manager.readMemory('test-bot', '../../etc/passwd')).toThrow(
        'Path traversal blocked',
      );
      expect(() => manager.readMemory('test-bot', '../outside.md')).toThrow(
        'Path traversal blocked',
      );
    });

    it('throws on missing file', () => {
      expect(() => manager.readMemory('test-bot', 'nonexistent.md')).toThrow(
        'Memory file not found',
      );
    });
  });

  // ── listSources ──────────────────────────────────────

  describe('listSources', () => {
    it('returns sorted file list', () => {
      manager.appendMemory('test-bot', 'Day 1', '2026-05-01');
      manager.appendMemory('test-bot', 'Day 2', '2026-05-02');
      manager.appendMemory('test-bot', 'Day 3', '2026-05-03');

      const sources = manager.listSources('test-bot');
      expect(sources.length).toBe(3);
      // Sorted descending by filename (date)
      expect(sources[0].file).toBe('2026-05-03.md');
      expect(sources[1].file).toBe('2026-05-02.md');
      expect(sources[2].file).toBe('2026-05-01.md');
      expect(sources[0].type).toBe('date');
      expect(sources[0].size).toBeGreaterThan(0);
    });

    it('returns empty for bot with no memory', () => {
      const sources = manager.listSources('empty-bot');
      expect(sources).toEqual([]);
    });

    it('includes txt files as note type', () => {
      manager.writeMemory('test-bot', 'notes.txt', 'Some note');
      const sources = manager.listSources('test-bot');
      const noteSource = sources.find(s => s.file === 'notes.txt');
      expect(noteSource).toBeDefined();
      expect(noteSource!.type).toBe('note');
    });
  });

  // ── writeMemory ──────────────────────────────────────

  describe('writeMemory', () => {
    it('uses a configured subject workspace resolver', () => {
      const workspace = join(TEST_DIR, 'corp', 'acme', 'agents', 'sales-zhangsan');
      const scoped = new MemoryManager(TEST_DIR, {
        subjectDirResolver: (subject) => subject === 'sales-zhangsan' ? workspace : undefined,
      });

      scoped.writeMemory('sales-zhangsan', 'notes.md', 'Employee-local memory');

      expect(readFileSync(join(workspace, 'memory', 'notes.md'), 'utf-8')).toBe('Employee-local memory');
    });

    it('writes content to file', () => {
      manager.writeMemory('test-bot', 'custom.md', '# Custom content');
      const content = manager.readMemory('test-bot', 'custom.md');
      expect(content).toBe('# Custom content');
    });

    it('overwrites existing file', () => {
      manager.writeMemory('test-bot', 'overwrite.md', 'First version');
      manager.writeMemory('test-bot', 'overwrite.md', 'Second version');
      const content = manager.readMemory('test-bot', 'overwrite.md');
      expect(content).toBe('Second version');
    });

    it('blocks path traversal', () => {
      expect(() => manager.writeMemory('test-bot', '../../evil.md', 'hack')).toThrow(
        'Path traversal blocked',
      );
    });

    it('rejects non-md/txt files', () => {
      expect(() => manager.writeMemory('test-bot', 'script.js', 'code')).toThrow(
        'Only .md and .txt files are allowed',
      );
      expect(() => manager.writeMemory('test-bot', 'data.json', '{}')).toThrow(
        'Only .md and .txt files are allowed',
      );
    });
  });
});
