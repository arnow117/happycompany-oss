import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TenantExporter } from '../src/tenant-export.js';

describe('TenantExporter', () => {
  let testDir: string;
  let tenantDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tenant-export-'));
    tenantDir = path.join(testDir, 'test-tenant');

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, '.claude', 'skills', 'test-skill'), { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify({ displayName: 'Test' }));
    fs.writeFileSync(path.join(tenantDir, 'people.json'), '{}');
    fs.writeFileSync(path.join(tenantDir, 'employees', 'agent1.yaml'), 'id: agent1\nrole: sales');
    fs.writeFileSync(path.join(tenantDir, '.claude', 'skills', 'test-skill', 'SKILL.md'), '---\nname: test\n---\n\n# Test');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('exports tenant as zip buffer', async () => {
    const zipBuffer = await new TenantExporter().exportTenant(tenantDir);
    expect(zipBuffer).toBeInstanceOf(Buffer);
    expect(zipBuffer.length).toBeGreaterThan(0);
  });

  it('zip contains required files', async () => {
    const zipPath = path.join(testDir, 'output.zip');
    const zipBuffer = await new TenantExporter().exportTenant(tenantDir);
    fs.writeFileSync(zipPath, zipBuffer);

    const extractDir = path.join(testDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', zipPath, '-d', extractDir]);

    expect(fs.existsSync(path.join(extractDir, 'tenant-export.json'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'employees', 'agent1.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'roles.json'))).toBe(false);
  });

  it('tenant-export.json has metadata', async () => {
    const zipPath = path.join(testDir, 'output.zip');
    const zipBuffer = await new TenantExporter().exportTenant(tenantDir);
    fs.writeFileSync(zipPath, zipBuffer);

    const extractDir = path.join(testDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir]);

    const meta = JSON.parse(fs.readFileSync(path.join(extractDir, 'tenant-export.json'), 'utf-8'));
    expect(meta.version).toBe('1.0.0');
    expect(meta.exportedAt).toBeTruthy();
  });
});
