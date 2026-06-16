import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initWorkdir,
  loadWorkdir,
} from '../src/workdir.js';

let tmpDir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unified-test-workdir-'));
}

beforeEach(() => {
  tmpDir = makeTempDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initWorkdir', () => {
  it('creates directory structure', () => {
    const workdir = path.join(tmpDir, 'workspace');
    initWorkdir(workdir);

    expect(fs.existsSync(path.join(workdir, '.claude', 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(workdir, 'uploads'))).toBe(true);
  });

  it('returns workdir info', () => {
    const workdir = path.join(tmpDir, 'workspace');
    const info = initWorkdir(workdir);

    expect(info.path).toBe(workdir);
  });

  it('is idempotent and does not overwrite existing files', () => {
    const workdir = path.join(tmpDir, 'workspace');
    initWorkdir(workdir);
    const skillDir = path.join(workdir, '.claude', 'skills', 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'content');

    initWorkdir(workdir);
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe('content');
  });
});

describe('loadWorkdir', () => {
  it('returns null for non-initialized workdir', () => {
    const workdir = path.join(tmpDir, 'workspace');
    expect(loadWorkdir(workdir)).toBeNull();
  });

  it('loads initialized workdir info', () => {
    const workdir = path.join(tmpDir, 'workspace');
    initWorkdir(workdir);

    const info = loadWorkdir(workdir);
    expect(info).not.toBeNull();
    expect(info!.path).toBe(workdir);
  });

  it('returns null for a directory without runtime structure', () => {
    const workdir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workdir, { recursive: true });

    expect(loadWorkdir(workdir)).toBeNull();
  });
});
