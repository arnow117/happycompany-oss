import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  generateCapabilityDesc,
  injectDescIntoPrompt,
} from '../src/desc.js';

let tmpDir: string;
let workdir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unified-test-desc-'));
}

beforeEach(() => {
  tmpDir = makeTempDir();
  workdir = path.join(tmpDir, 'workdir');
  fs.mkdirSync(
    path.join(workdir, '.claude', 'skills'),
    { recursive: true },
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createSkillFile(
  appName: string,
  content: string,
): void {
  const skillDir = path.join(workdir, '.claude', 'skills', appName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
}

describe('generateCapabilityDesc', () => {
  it('generates capability block from app skill files', () => {
    createSkillFile('my-skill', `---
name: My Skill
description: Does something useful
---
Instructions`);

    const result = generateCapabilityDesc(workdir, ['my-skill']);
    expect(result).toContain('## Available Capabilities');
    expect(result).toContain('**My Skill**: Does something useful');
  });

  it('returns empty string when no skills found', () => {
    const result = generateCapabilityDesc(workdir, ['non-existent']);
    expect(result).toBe('');
  });

  it('returns empty string for empty appNames list', () => {
    const result = generateCapabilityDesc(workdir, []);
    expect(result).toBe('');
  });

  it('ignores malformed installed app entries without names', () => {
    createSkillFile('valid-skill', `---
name: Valid Skill
description: Still available
---`);

    const result = generateCapabilityDesc(workdir, [undefined as unknown as string, '', 'valid-skill']);
    expect(result).toContain('**Valid Skill**: Still available');
  });

  it('handles multiple apps', () => {
    createSkillFile('skill-a', `---
name: Skill A
description: First capability
---`);
    createSkillFile('skill-b', `---
name: Skill B
description: Second capability
---`);

    const result = generateCapabilityDesc(workdir, ['skill-a', 'skill-b']);
    expect(result).toContain('**Skill A**: First capability');
    expect(result).toContain('**Skill B**: Second capability');
  });

  it('skips apps without SKILL.md', () => {
    createSkillFile('has-skill', `---
name: Has Skill
description: Present
---`);

    const result = generateCapabilityDesc(workdir, ['has-skill', 'no-skill']);
    expect(result).toContain('Has Skill');
    expect(result).not.toContain('no-skill');
  });

  it('skips skills without description', () => {
    createSkillFile('no-desc', `---
name: No Desc
---
Body only`);

    const result = generateCapabilityDesc(workdir, ['no-desc']);
    expect(result).toBe('');
  });

  it('falls back to app name when frontmatter has no name', () => {
    createSkillFile('fallback-name', `---
description: Uses directory name
---
Body`);

    const result = generateCapabilityDesc(workdir, ['fallback-name']);
    expect(result).toContain('**fallback-name**: Uses directory name');
  });

  it('formats output with proper markdown structure', () => {
    createSkillFile('fmt-skill', `---
name: Formatted
description: Well structured
---`);

    const result = generateCapabilityDesc(workdir, ['fmt-skill']);
    expect(result).toBe(
      `## Available Capabilities\n\n- **Formatted**: Well structured\n`,
    );
  });
});

describe('injectDescIntoPrompt', () => {
  it('appends capability block to base prompt', () => {
    const base = 'You are a helpful assistant.';
    const caps = '## Available Capabilities\n\n- **Test**: A skill\n';

    const result = injectDescIntoPrompt(base, caps);
    expect(result).toBe(`${base}\n\n${caps}`);
  });

  it('returns base prompt unchanged when capabilities is empty', () => {
    const base = 'You are a helpful assistant.';
    const result = injectDescIntoPrompt(base, '');
    expect(result).toBe(base);
  });

  it('handles base prompt with existing trailing newline', () => {
    const base = 'You are a helpful assistant.\n';
    const caps = '## Available Capabilities\n\n- **Test**: A skill\n';

    const result = injectDescIntoPrompt(base, caps);
    // Always appends with \n\n regardless of trailing newline on base
    expect(result).toBe(`${base}\n\n${caps}`);
  });

  it('returns capabilities-only when base prompt is empty', () => {
    const caps = '## Available Capabilities\n\n- **Test**: A skill\n';
    const result = injectDescIntoPrompt('', caps);
    expect(result).toBe(`\n\n${caps}`);
  });

  it('works end-to-end with generateCapabilityDesc', () => {
    createSkillFile('e2e-skill', `---
name: E2E Skill
description: End to end test
---`);

    const caps = generateCapabilityDesc(workdir, ['e2e-skill']);
    const result = injectDescIntoPrompt('System prompt', caps);

    expect(result).toContain('System prompt');
    expect(result).toContain('## Available Capabilities');
    expect(result).toContain('**E2E Skill**: End to end test');
  });
});
