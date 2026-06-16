import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  hasCliEntry,
  listCliApps,
  runAppCli,
} from '../src/app-runner.js';

let tmpDir: string;
let workdir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unified-test-app-runner-'));
}

function makeAppWithCli(
  baseWorkdir: string,
  appName: string,
  scriptContent: string,
): void {
  const binDir = path.join(
    baseWorkdir,
    '.claude',
    'skills',
    appName,
    'bin',
  );
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'run');
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
}

beforeEach(() => {
  tmpDir = makeTempDir();
  workdir = path.join(tmpDir, 'workdir');
  fs.mkdirSync(workdir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- hasCliEntry ---

describe('hasCliEntry', () => {
  it('returns false when no CLI entry point exists', () => {
    expect(hasCliEntry(workdir, 'nonexistent')).toBe(false);
  });

  it('returns false for a skill directory without bin/run', () => {
    const skillDir = path.join(workdir, '.claude', 'skills', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# test');

    expect(hasCliEntry(workdir, 'my-skill')).toBe(false);
  });

  it('returns false when bin/run exists but is not executable', () => {
    const binDir = path.join(workdir, '.claude', 'skills', 'my-skill', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'run'), '#!/bin/bash\necho hi', {
      mode: 0o644,
    });

    expect(hasCliEntry(workdir, 'my-skill')).toBe(false);
  });

  it('returns true when bin/run exists and is executable', () => {
    makeAppWithCli(workdir, 'my-skill', '#!/usr/bin/env bash\necho hello');

    expect(hasCliEntry(workdir, 'my-skill')).toBe(true);
  });
});

// --- listCliApps ---

describe('listCliApps', () => {
  it('returns empty array when no skills directory exists', () => {
    expect(listCliApps(workdir)).toEqual([]);
  });

  it('returns empty array when skills exist but none have CLI entry points', () => {
    const skillDir = path.join(workdir, '.claude', 'skills', 'no-cli');
    fs.mkdirSync(skillDir, { recursive: true });

    expect(listCliApps(workdir)).toEqual([]);
  });

  it('lists apps that have executable bin/run', () => {
    makeAppWithCli(workdir, 'app-a', '#!/usr/bin/env bash\necho a');
    makeAppWithCli(workdir, 'app-b', '#!/usr/bin/env bash\necho b');

    const result = listCliApps(workdir);
    expect(result).toContain('app-a');
    expect(result).toContain('app-b');
    expect(result).toHaveLength(2);
  });

  it('excludes skills that have SKILL.md but no CLI entry', () => {
    makeAppWithCli(workdir, 'with-cli', '#!/usr/bin/env bash\necho yes');

    const noCliDir = path.join(workdir, '.claude', 'skills', 'no-cli');
    fs.mkdirSync(noCliDir, { recursive: true });
    fs.writeFileSync(path.join(noCliDir, 'SKILL.md'), '# no cli');

    expect(listCliApps(workdir)).toEqual(['with-cli']);
  });
});

// --- runAppCli ---

describe('runAppCli', () => {
  it('returns error result for app without CLI entry point', async () => {
    const result = await runAppCli({
      appName: 'missing',
      workdir,
      args: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('No CLI entry point found');
    expect(result.durationMs).toBe(0);
  });

  it('runs the CLI script and captures stdout', async () => {
    makeAppWithCli(workdir, 'echo-app', '#!/usr/bin/env bash\necho "hello from cli"');

    const result = await runAppCli({
      appName: 'echo-app',
      workdir,
      args: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello from cli');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('passes args to the CLI script', async () => {
    makeAppWithCli(
      workdir,
      'args-app',
      '#!/usr/bin/env bash\necho "Args: $*"',
    );

    const result = await runAppCli({
      appName: 'args-app',
      workdir,
      args: ['--verbose', 'input.txt', '--output=out.json'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('--verbose');
    expect(result.output).toContain('input.txt');
    expect(result.output).toContain('--output=out.json');
  });

  it('pipes input to stdin when provided', async () => {
    makeAppWithCli(
      workdir,
      'stdin-app',
      '#!/usr/bin/env bash\ncat',
    );

    const result = await runAppCli({
      appName: 'stdin-app',
      workdir,
      args: [],
      input: 'hello stdin',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello stdin');
  });

  it('returns timeout error when CLI exceeds timeout', async () => {
    makeAppWithCli(
      workdir,
      'slow-app',
      '#!/usr/bin/env bash\nsleep 10\necho "should not reach"',
    );

    const result = await runAppCli({
      appName: 'slow-app',
      workdir,
      args: [],
      timeoutMs: 200,
    });

    expect(result.exitCode).toBe(124);
    expect(result.output).toContain('timed out');
    expect(result.durationMs).toBeGreaterThanOrEqual(200);
  });

  it('captures stderr output', async () => {
    makeAppWithCli(
      workdir,
      'stderr-app',
      '#!/usr/bin/env bash\necho "stdout line"\necho "stderr line" >&2',
    );

    const result = await runAppCli({
      appName: 'stderr-app',
      workdir,
      args: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('stdout line');
    expect(result.output).toContain('stderr line');
  });

  it('returns exitCode 1 when CLI script fails', async () => {
    makeAppWithCli(
      workdir,
      'fail-app',
      '#!/usr/bin/env bash\necho "error" >&2\nexit 1',
    );

    const result = await runAppCli({
      appName: 'fail-app',
      workdir,
      args: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('error');
  });

  it('runs the sample test-app bundled in apps/', async () => {
    const sampleAppDir = path.resolve(
      import.meta.dirname,
      '..',
      'apps',
      'test-app',
      'v1.0',
    );

    // Copy the sample app into the workdir's skills directory
    const destDir = path.join(workdir, '.claude', 'skills', 'test-app');
    fs.cpSync(sampleAppDir, destDir, { recursive: true });

    const result = await runAppCli({
      appName: 'test-app',
      workdir,
      args: ['--flag', 'value'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('App CLI: test-app');
    expect(result.output).toContain('--flag');
    expect(result.output).toContain('value');
  });
});
