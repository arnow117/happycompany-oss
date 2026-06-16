import { describe, it, expect } from 'vitest';
import { markdownToPlainText, splitTextChunks } from '../src/im-utils.js';

describe('markdownToPlainText', () => {
  it('removes bold markers', () => {
    expect(markdownToPlainText('**hello**')).toBe('hello');
  });

  it('removes italic markers', () => {
    expect(markdownToPlainText('*hello*')).toBe('hello');
  });

  it('removes inline code markers', () => {
    expect(markdownToPlainText('use `npm install`')).toBe('use npm install');
  });

  it('extracts code from fenced blocks', () => {
    const result = markdownToPlainText('```js\nconst x = 1;\n```');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('extracts link text and URL', () => {
    expect(markdownToPlainText('[Google](https://google.com)')).toBe('Google (https://google.com)');
  });

  it('removes strikethrough', () => {
    expect(markdownToPlainText('~~deleted~~')).toBe('deleted');
  });

  it('removes heading markers', () => {
    expect(markdownToPlainText('## Title')).toBe('Title');
  });

  it('handles empty string', () => {
    expect(markdownToPlainText('')).toBe('');
  });

  it('handles plain text unchanged', () => {
    expect(markdownToPlainText('hello world')).toBe('hello world');
  });

  it('handles complex markdown', () => {
    const md = '# Title\n\n**Bold** and *italic* with [link](https://example.com)';
    const result = markdownToPlainText(md);
    expect(result).toContain('Title');
    expect(result).toContain('Bold');
    expect(result).toContain('italic');
    expect(result).toContain('link');
  });
});

describe('splitTextChunks', () => {
  it('returns single chunk for short text', () => {
    expect(splitTextChunks('hello', 100)).toEqual(['hello']);
  });

  it('splits at paragraph boundary', () => {
    const text = 'AAAA\n\nBBBB\n\nCCCC';
    const chunks = splitTextChunks(text, 6);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(8);
    }
  });

  it('splits at line boundary when no paragraph boundary', () => {
    const text = 'AAAA\nBBBB\nCCCC\nDDDD';
    const chunks = splitTextChunks(text, 6);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits at word boundary when no line boundary', () => {
    const text = 'AAA BBB CCC DDD EEE';
    const chunks = splitTextChunks(text, 7);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-splits when no boundary available', () => {
    const text = 'ABCDEFGHIJ';
    const chunks = splitTextChunks(text, 3);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
  });

  it('preserves all words', () => {
    const text = 'Line one\n\nLine two\n\nLine three';
    const chunks = splitTextChunks(text, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!).toBe(text);
  });
});
