import { describe, it, expect } from 'vitest';
import { extractFileText } from '../src/dingtalk-utils.js';

describe('extractFileText', () => {
  it('extracts text from .txt files', () => {
    const buffer = Buffer.from('Hello, world!', 'utf-8');
    expect(extractFileText(buffer, 'hello.txt')).toBe('Hello, world!');
  });

  it('extracts text from .csv files', () => {
    const buffer = Buffer.from('name,age\nAlice,30', 'utf-8');
    expect(extractFileText(buffer, 'data.csv')).toBe('name,age\nAlice,30');
  });

  it('extracts text from .json files', () => {
    const buffer = Buffer.from('{"key": "value"}', 'utf-8');
    expect(extractFileText(buffer, 'config.json')).toBe('{"key": "value"}');
  });

  it('extracts text from .md files', () => {
    const buffer = Buffer.from('# Title\n\nContent here', 'utf-8');
    expect(extractFileText(buffer, 'readme.md')).toBe('# Title\n\nContent here');
  });

  it('extracts text from .log files', () => {
    const buffer = Buffer.from('2024-01-01 INFO test', 'utf-8');
    expect(extractFileText(buffer, 'app.log')).toBe('2024-01-01 INFO test');
  });

  it('extracts text from .ts files', () => {
    const buffer = Buffer.from('const x = 1;', 'utf-8');
    expect(extractFileText(buffer, 'index.ts')).toBe('const x = 1;');
  });

  it('extracts text from .yaml files', () => {
    const buffer = Buffer.from('key: value', 'utf-8');
    expect(extractFileText(buffer, 'config.yaml')).toBe('key: value');
  });

  it('extracts text from .yml files', () => {
    const buffer = Buffer.from('key: value', 'utf-8');
    expect(extractFileText(buffer, 'config.yml')).toBe('key: value');
  });

  it('extracts text from .sql files', () => {
    const buffer = Buffer.from('SELECT * FROM users', 'utf-8');
    expect(extractFileText(buffer, 'query.sql')).toBe('SELECT * FROM users');
  });

  it('extracts text from .xml files', () => {
    const buffer = Buffer.from('<root><item/></root>', 'utf-8');
    expect(extractFileText(buffer, 'data.xml')).toBe('<root><item/></root>');
  });

  it('returns placeholder for .xlsx files', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(extractFileText(buffer, 'spreadsheet.xlsx')).toBe('[binary file: spreadsheet.xlsx]');
  });

  it('returns placeholder for .xls files', () => {
    const buffer = Buffer.from([0xd0, 0xcf]);
    expect(extractFileText(buffer, 'old.xls')).toBe('[binary file: old.xls]');
  });

  it('returns placeholder for .docx files', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(extractFileText(buffer, 'document.docx')).toBe('[binary file: document.docx]');
  });

  it('returns placeholder for .pdf files', () => {
    const buffer = Buffer.from('%PDF-1.4');
    expect(extractFileText(buffer, 'report.pdf')).toBe('[binary file: report.pdf]');
  });

  it('returns placeholder for unknown extensions', () => {
    const buffer = Buffer.from('some data');
    expect(extractFileText(buffer, 'file.xyz')).toBe('[binary file: file.xyz]');
  });

  it('returns placeholder for files with no extension', () => {
    const buffer = Buffer.from('some data');
    expect(extractFileText(buffer, 'Makefile')).toBe('[binary file: Makefile]');
  });

  it('handles empty buffer for text files', () => {
    const buffer = Buffer.alloc(0);
    expect(extractFileText(buffer, 'empty.txt')).toBe('');
  });

  it('handles unicode content in text files', () => {
    const buffer = Buffer.from('你好世界', 'utf-8');
    expect(extractFileText(buffer, 'chinese.txt')).toBe('你好世界');
  });
});
