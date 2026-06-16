import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateSkillId,
  validateSkillPath,
  parseFrontmatter,
  listFiles,
  scanSkillDirectory,
} from '../src/skills.js';

let tmpDir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unified-test-skills-'));
}

beforeEach(() => {
  tmpDir = makeTempDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateSkillId', () => {
  it('accepts alphanumeric and hyphen IDs', () => {
    expect(validateSkillId('my-skill')).toBe(true);
    expect(validateSkillId('skill_42')).toBe(true);
    expect(validateSkillId('abc')).toBe(true);
  });

  it('rejects IDs with path traversal characters', () => {
    expect(validateSkillId('../escape')).toBe(false);
    expect(validateSkillId('/absolute')).toBe(false);
    expect(validateSkillId('has space')).toBe(false);
    expect(validateSkillId('has.dot')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(validateSkillId('')).toBe(false);
  });
});

describe('validateSkillPath', () => {
  it('accepts valid subdirectory paths', () => {
    expect(validateSkillPath('/skills', '/skills/my-skill')).toBe(true);
  });

  it('rejects paths that escape the root via ..', () => {
    expect(validateSkillPath('/skills', '/skills/../etc/passwd')).toBe(false);
    expect(validateSkillPath('/skills', '/etc/passwd')).toBe(false);
  });

  it('rejects empty relative path', () => {
    expect(validateSkillPath('/skills', '/skills')).toBe(false);
  });
});

describe('parseFrontmatter', () => {
  it('parses simple key-value pairs', () => {
    const content = `---
name: test-skill
description: A test skill
---
Body content`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
  });

  it('returns empty object when no frontmatter', () => {
    const content = 'No frontmatter here';
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('returns empty object when closing --- is missing', () => {
    const content = `---
name: test
Body continues without closing`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('parses folded multiline values with >', () => {
    const content = `---
description: >
  This is a long
  description that
  spans multiple lines
---
Body`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('This is a long description that spans multiple lines');
  });

  it('parses literal multiline values with |', () => {
    const content = `---
instructions: |
  Step 1: Do this
  Step 2: Do that
---
Body`;
    const result = parseFrontmatter(content);
    expect(result.instructions).toBe('Step 1: Do this\nStep 2: Do that');
  });

  it('parses user-invocable and allowed-tools fields', () => {
    const content = `---
user-invocable: false
allowed-tools: Read, Write, Edit
---
Body`;
    const result = parseFrontmatter(content);
    expect(result['user-invocable']).toBe('false');
    expect(result['allowed-tools']).toBe('Read, Write, Edit');
  });
});

describe('listFiles', () => {
  it('lists files and directories in a directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');

    const files = listFiles(tmpDir);
    expect(files).toHaveLength(2);

    const fileEntry = files.find((f) => f.name === 'file1.txt');
    expect(fileEntry).toBeDefined();
    expect(fileEntry!.type).toBe('file');
    expect(fileEntry!.size).toBeGreaterThan(0);

    const dirEntry = files.find((f) => f.name === 'subdir');
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.type).toBe('directory');
    expect(dirEntry!.size).toBe(0);
  });

  it('skips hidden files and directories', () => {
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.writeFileSync(path.join(tmpDir, '.dotfile'), '');

    const files = listFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('returns empty array for non-existent directory', () => {
    const files = listFiles('/non/existent/path');
    expect(files).toEqual([]);
  });

  it('resolves symlinks to their target type', () => {
    const targetDir = path.join(tmpDir, 'target-dir');
    const targetFile = path.join(tmpDir, 'target-file.txt');
    fs.mkdirSync(targetDir);
    fs.writeFileSync(targetFile, 'content');

    const linkDir = path.join(tmpDir, 'link-dir');
    const linkFile = path.join(tmpDir, 'link-file');
    fs.symlinkSync(targetDir, linkDir);
    fs.symlinkSync(targetFile, linkFile);

    const files = listFiles(tmpDir);
    const dirLink = files.find((f) => f.name === 'link-dir');
    const fileLink = files.find((f) => f.name === 'link-file');
    expect(dirLink).toBeDefined();
    expect(dirLink!.type).toBe('directory');
    expect(fileLink).toBeDefined();
    expect(fileLink!.type).toBe('file');
  });
});

describe('scanSkillDirectory', () => {
  function createSkill(
    dir: string,
    name: string,
    content: string,
    disabled = false,
  ): void {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    const filename = disabled ? 'SKILL.md.disabled' : 'SKILL.md';
    fs.writeFileSync(path.join(skillDir, filename), content);
  }

  it('scans a directory with a valid SKILL.md', () => {
    createSkill(tmpDir, 'my-skill', `---
name: My Skill
description: A skill for testing
---
Instructions here`);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('my-skill');
    expect(skills[0].name).toBe('My Skill');
    expect(skills[0].description).toBe('A skill for testing');
    expect(skills[0].source).toBe('test');
    expect(skills[0].enabled).toBe(true);
  });

  it('sets enabled=false for SKILL.md.disabled', () => {
    createSkill(tmpDir, 'disabled-skill', `---
name: Disabled
---
Body`, true);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills).toHaveLength(1);
    expect(skills[0].enabled).toBe(false);
  });

  it('skips directories without SKILL.md', () => {
    fs.mkdirSync(path.join(tmpDir, 'not-a-skill'));
    fs.writeFileSync(path.join(tmpDir, 'not-a-skill', 'README.md'), 'hello');

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills).toHaveLength(0);
  });

  it('defaults name to directory name when not in frontmatter', () => {
    createSkill(tmpDir, 'dir-name', `---
description: No name field
---
Body`);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills[0].name).toBe('dir-name');
  });

  it('parses user-invocable and allowed-tools from frontmatter', () => {
    createSkill(tmpDir, 'tools-skill', `---
user-invocable: false
allowed-tools: Read, Write
---
Body`);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills[0].userInvocable).toBe(false);
    expect(skills[0].allowedTools).toEqual(['Read', 'Write']);
  });

  it('defaults userInvocable to true when not specified', () => {
    createSkill(tmpDir, 'default-skill', `---
name: Default
---
Body`);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills[0].userInvocable).toBe(true);
  });

  it('returns empty array for non-existent directory', () => {
    const skills = scanSkillDirectory('/non/existent', 'test');
    expect(skills).toEqual([]);
  });

  it('scans multiple skills', () => {
    createSkill(tmpDir, 'skill-a', `---
name: Skill A
description: First
---`);
    createSkill(tmpDir, 'skill-b', `---
name: Skill B
description: Second
---`);

    const skills = scanSkillDirectory(tmpDir, 'test');
    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain('skill-a');
    expect(ids).toContain('skill-b');
  });
});
