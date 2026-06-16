import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Path to the actual kb-management app source
const KB_APP_SOURCE = path.resolve(
  import.meta.dirname,
  '..',
  'apps',
  'kb-management',
  'v1.0',
);

describe('kb-management app', () => {
  it('has a valid source directory with required files', () => {
    expect(fs.existsSync(KB_APP_SOURCE)).toBe(true);
    expect(fs.existsSync(path.join(KB_APP_SOURCE, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(KB_APP_SOURCE, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(KB_APP_SOURCE, 'CLAUDE.md'))).toBe(true);
  });

  it('has SKILL.md with required frontmatter fields', () => {
    const content = fs.readFileSync(
      path.join(KB_APP_SOURCE, 'SKILL.md'),
      'utf-8',
    );

    // Verify frontmatter delimiters
    expect(content.startsWith('---\n')).toBe(true);

    // Verify required fields are present
    expect(content).toContain('name: kb-management');
    expect(content).toMatch(/description:\s*>?/);
    expect(content).toContain('user-invocable: true');
    expect(content).toContain('argument-hint:');
  });

  it('has CLI entry points that are executable', () => {
    const ingestPath = path.join(KB_APP_SOURCE, 'bin', 'ingest');
    const queryPath = path.join(KB_APP_SOURCE, 'bin', 'query');

    expect(fs.existsSync(ingestPath)).toBe(true);
    expect(fs.existsSync(queryPath)).toBe(true);

    // Check executable permission on Unix
    try {
      expect(fs.statSync(ingestPath).mode & 0o111).toBeTruthy();
      expect(fs.statSync(queryPath).mode & 0o111).toBeTruthy();
    } catch {
      // Skip permission check on Windows
    }
  });
});
