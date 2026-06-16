import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirSyncService } from '../src/workdir-sync.js';
import { WorkdirScanner } from '../src/workdir-scanner.js';

describe('WorkdirSyncService', () => {
  let testDir: string;
  let syncDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'workdir-sync-'));
    syncDir = path.join(testDir, 'sync-state');
    fs.mkdirSync(syncDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function createSkill(workdir: string, name: string, desc: string): void {
    const dir = path.join(workdir, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}`);
  }

  it('detects new skills on first sync', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'Test');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    const result = service.sync(workdir);

    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toBe('test-skill');
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('detects no changes on re-sync', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'Test');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);
    const result = service.sync(workdir);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('detects removed skills', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'old-skill', 'Old');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);

    fs.rmSync(path.join(workdir, '.claude', 'skills', 'old-skill'), { recursive: true, force: true });

    const result = service.sync(workdir);
    expect(result.removed).toContain('old-skill');
  });

  it('detects changed skills (hash mismatch)', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'V1');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);

    // Modify
    const skillMd = path.join(workdir, '.claude', 'skills', 'test-skill', 'SKILL.md');
    fs.writeFileSync(skillMd, '---\nname: test-skill\ndescription: V2\n---\n\n# V2');

    const result = service.sync(workdir);
    expect(result.changed).toContain('test-skill');
  });
});
