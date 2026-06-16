import { describe, it, expect } from 'vitest';
import { sanitizeFileName, buildFileContentBlock } from '../src/sanitize.js';

describe('sanitizeFileName', () => {
  it('removes control characters', () => {
    expect(sanitizeFileName('file\x00name.txt')).toBe('file name.txt');
  });

  it('removes backticks and box-drawing chars', () => {
    expect(sanitizeFileName('`file─name`.txt')).toBe('file name .txt');
  });

  it('collapses whitespace', () => {
    expect(sanitizeFileName('file   name.txt')).toBe('file name.txt');
  });

  it('trims leading/trailing spaces', () => {
    expect(sanitizeFileName('  name.txt  ')).toBe('name.txt');
  });

  it('truncates at 200 characters', () => {
    const long = 'a'.repeat(250) + '.txt';
    const result = sanitizeFileName(long);
    expect(result.length).toBeLessThanOrEqual(203);
    expect(result.endsWith('…'));
  });

  it('handles normal filenames unchanged', () => {
    expect(sanitizeFileName('report.pdf')).toBe('report.pdf');
  });
});

describe('buildFileContentBlock', () => {
  it('builds block with text content', () => {
    const result = buildFileContentBlock({
      fileName: 'test.txt',
      textContent: 'hello world',
    });
    expect(result).toContain('[文件: test.txt]');
    expect(result).toContain('hello world');
    expect(result).toContain('===CONTENT_');
  });

  it('builds block with filePath', () => {
    const result = buildFileContentBlock({
      fileName: 'doc.pdf',
      textContent: 'content',
      filePath: '/tmp/doc.pdf',
    });
    expect(result).toContain('原文件: /tmp/doc.pdf');
  });

  it('uses custom prefix label', () => {
    const result = buildFileContentBlock({
      fileName: 'data.csv',
      textContent: 'a,b,c',
      prefixLabel: '附件',
    });
    expect(result).toContain('[附件: data.csv]');
  });

  it('returns simple label when no text content', () => {
    const result = buildFileContentBlock({
      fileName: 'image.png',
      textContent: null,
    });
    expect(result).toBe('[文件: image.png]');
  });

  it('truncates very long content', () => {
    const longContent = 'x'.repeat(40_000);
    const result = buildFileContentBlock({
      fileName: 'big.txt',
      textContent: longContent,
    });
    expect(result.length).toBeLessThanOrEqual(30_020);
    expect(result).toContain('[...已截断]');
  });
});
