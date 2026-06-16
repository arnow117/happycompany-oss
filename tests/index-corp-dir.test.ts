import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCorpDir } from '../src/corp-dir.js';

describe('resolveCorpDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happycompany-corp-dir-'));
  });

  afterEach(() => {
    delete process.env.HAPPYCOMPANY_CORP_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses HAPPYCOMPANY_CORP_DIR before config or defaults', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const envCorp = path.join(tmpDir, 'external-corp');
    const configCorp = path.join(tmpDir, 'config-corp');
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.HAPPYCOMPANY_CORP_DIR = envCorp;

    expect(resolveCorpDir(repoDir, configCorp)).toBe(envCorp);
  });

  it('uses configured corpDir when env var is not set', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const configCorp = path.join(tmpDir, 'configured-corp');
    fs.mkdirSync(repoDir, { recursive: true });

    expect(resolveCorpDir(repoDir, configCorp)).toBe(configCorp);
  });

  it('ignores unresolved env placeholders in config', () => {
    const localCorp = path.join(tmpDir, 'repo', 'corp');
    fs.mkdirSync(localCorp, { recursive: true });

    expect(resolveCorpDir(path.join(tmpDir, 'repo'), '$HAPPYCOMPANY_CORP_DIR')).toBe(localCorp);
  });

  it('prefers the repository-local corp directory', () => {
    const localCorp = path.join(tmpDir, 'repo', 'corp');
    const siblingCorp = path.join(tmpDir, 'corp');
    fs.mkdirSync(localCorp, { recursive: true });
    fs.mkdirSync(siblingCorp, { recursive: true });

    expect(resolveCorpDir(path.join(tmpDir, 'repo'))).toBe(localCorp);
  });

  it('falls back to the sibling corp directory for legacy workspaces', () => {
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });

    expect(resolveCorpDir(repoDir)).toBe(path.join(tmpDir, 'corp'));
  });
});
