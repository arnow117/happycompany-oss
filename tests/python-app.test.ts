import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectAppLanguage, runAppCli } from '../src/app-runner.js';

let tmpDir: string;
let workdir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unified-test-python-app-'));
}

function makeSkillDir(base: string, appName: string): string {
  const dir = path.join(base, '.claude', 'skills', appName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBinRun(skillDir: string, content: string): void {
  const binDir = path.join(skillDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'run'), content, { mode: 0o755 });
}

function writeSourceApp(
  base: string,
  appName: string,
  sourceDir: string,
): void {
  const skillDir = makeSkillDir(base, appName);
  // Copy the source directory contents into the skill directory
  fs.cpSync(sourceDir, skillDir, { recursive: true });
}

beforeEach(() => {
  tmpDir = makeTempDir();
  workdir = path.join(tmpDir, 'workdir');
  fs.mkdirSync(workdir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- detectAppLanguage ---

describe('detectAppLanguage', () => {
  it('detects "typescript" when package.json exists', () => {
    const skillDir = makeSkillDir(workdir, 'ts-app');
    fs.writeFileSync(
      path.join(skillDir, 'package.json'),
      '{"name": "ts-app"}',
    );

    expect(detectAppLanguage(workdir, 'ts-app')).toBe('typescript');
  });

  it('detects "python" when requirements.txt exists', () => {
    const skillDir = makeSkillDir(workdir, 'py-app');
    fs.writeFileSync(path.join(skillDir, 'requirements.txt'), '');

    expect(detectAppLanguage(workdir, 'py-app')).toBe('python');
  });

  it('detects "python" when .py files exist even without requirements.txt', () => {
    const skillDir = makeSkillDir(workdir, 'py-no-reqs');
    const srcDir = path.join(skillDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'main.py'), 'print("hi")');

    expect(detectAppLanguage(workdir, 'py-no-reqs')).toBe('python');
  });

  it('detects "shell" when bin/run exists without package.json or python signals', () => {
    const skillDir = makeSkillDir(workdir, 'shell-app');
    writeBinRun(skillDir, '#!/usr/bin/env bash\necho hi');

    expect(detectAppLanguage(workdir, 'shell-app')).toBe('shell');
  });

  it('detects "unknown" for an empty skill directory', () => {
    makeSkillDir(workdir, 'empty-app');

    expect(detectAppLanguage(workdir, 'empty-app')).toBe('unknown');
  });

  it('detects "unknown" for a nonexistent app', () => {
    expect(detectAppLanguage(workdir, 'no-such-app')).toBe('unknown');
  });

  it('detects "typescript" over "python" when both package.json and .py files exist', () => {
    const skillDir = makeSkillDir(workdir, 'mixed-app');
    fs.writeFileSync(
      path.join(skillDir, 'package.json'),
      '{"name": "mixed"}',
    );
    fs.writeFileSync(path.join(skillDir, 'main.py'), 'print("hi")');

    expect(detectAppLanguage(workdir, 'mixed-app')).toBe('typescript');
  });

  it('detects the bundled python-example app as "python"', () => {
    const sampleAppDir = path.resolve(
      import.meta.dirname,
      '..',
      'apps',
      'python-example',
      'v1.0',
    );

    writeSourceApp(workdir, 'python-example', sampleAppDir);

    expect(detectAppLanguage(workdir, 'python-example')).toBe('python');
  });
});

// --- runAppCli with python-example ---

describe('runAppCli with python-example', () => {
  it('runs the bundled python-example app and captures output', async () => {
    const sampleAppDir = path.resolve(
      import.meta.dirname,
      '..',
      'apps',
      'python-example',
      'v1.0',
    );

    writeSourceApp(workdir, 'python-example', sampleAppDir);

    const result = await runAppCli({
      appName: 'python-example',
      workdir,
      args: ['--name', 'Alice'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Hello, Alice!');
  });

  it('passes language flag to the python-example app', async () => {
    const sampleAppDir = path.resolve(
      import.meta.dirname,
      '..',
      'apps',
      'python-example',
      'v1.0',
    );

    writeSourceApp(workdir, 'python-example', sampleAppDir);

    const result = await runAppCli({
      appName: 'python-example',
      workdir,
      args: ['--name', 'Bob', '--lang', 'zh'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('你好, Bob!');
  });

  it('uses default values when no args provided', async () => {
    const sampleAppDir = path.resolve(
      import.meta.dirname,
      '..',
      'apps',
      'python-example',
      'v1.0',
    );

    writeSourceApp(workdir, 'python-example', sampleAppDir);

    const result = await runAppCli({
      appName: 'python-example',
      workdir,
      args: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Hello, World!');
  });
});
