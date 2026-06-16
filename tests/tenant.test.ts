import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TenantMgr } from '../src/tenant.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('TenantMgr', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTenant(name: string, appJson?: object): void {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    if (appJson) {
      fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(appJson, null, 2));
    }
  }

  it('discovers tenants with app.json', () => {
    createTenant('acme', { displayName: '示例医疗' });
    createTenant('foo', { displayName: 'Foo Corp' });

    const mgr = new TenantMgr(tmpDir);
    mgr.scan();

    expect(mgr.getTenantNames()).toEqual(['acme', 'foo']);
    expect(mgr.getTenant('acme')?.appJson?.displayName).toBe('示例医疗');
  });

  it('skips directories without app.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty_dir'), { recursive: true });
    createTenant('valid', { displayName: 'Valid' });

    const mgr = new TenantMgr(tmpDir);
    mgr.scan();

    expect(mgr.getTenantNames()).toEqual(['valid']);
  });

  it('resolveFromAgentDir matches bot inside tenant', () => {
    createTenant('acme', { displayName: '示例医疗' });

    const mgr = new TenantMgr(tmpDir);
    mgr.scan();

    const resolved = mgr.resolveFromAgentDir(path.join(tmpDir, 'acme', '.claude', 'agents', 'sales-bot'));
    expect(resolved?.name).toBe('acme');
  });

  it('resolveFromAgentDir returns undefined for unknown path', () => {
    createTenant('acme', { displayName: '示例医疗' });

    const mgr = new TenantMgr(tmpDir);
    mgr.scan();

    expect(mgr.resolveFromAgentDir('/some/other/path')).toBeUndefined();
  });

  it('dataDir creates and returns path', () => {
    createTenant('acme', { displayName: '示例医疗' });

    const mgr = new TenantMgr(tmpDir);
    mgr.scan();

    const dataDir = mgr.dataDir('acme');
    expect(dataDir).toContain(path.join('acme', 'data'));
    expect(fs.existsSync(dataDir)).toBe(true);
  });
});
