import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/verify-acme-tenant-acceptance.mjs');
const sourceSkillDir = resolve(process.cwd(), 'corp/acme/.claude/skills/med_crm');

function makeTenant(corpDir: string, options: { removeWriteTools?: boolean } = {}): string {
  const tenantDir = join(corpDir, 'acme-happycompany');
  const skillDir = join(tenantDir, '.claude', 'skills', 'med_crm');
  mkdirSync(skillDir, { recursive: true });
  cpSync(sourceSkillDir, skillDir, { recursive: true });
  writeFileSync(join(tenantDir, 'app.json'), JSON.stringify({ name: 'acme-happycompany' }), 'utf-8');
  if (options.removeWriteTools) {
    const toolsPath = join(skillDir, 'tools.json');
    const manifest = JSON.parse(readFileSync(toolsPath, 'utf-8')) as {
      tools: Array<{ name: string }>;
    };
    manifest.tools = manifest.tools.filter((tool) => ![
      'contract_intake',
      'create_service_record',
      'finance_settlement',
    ].includes(tool.name));
    writeFileSync(toolsPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }
  return skillDir;
}

describe('verify-acme-tenant-acceptance script', () => {
  it('reports not-ready without modifying a tenant that lacks write tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-real-tenant-not-ready-'));
    const output = join(dir, 'readiness.json');
    try {
      const skillDir = makeTenant(dir, { removeWriteTools: true });
      const originalTools = readFileSync(join(skillDir, 'tools.json'), 'utf-8');

      const result = spawnSync(
        'node',
        [scriptPath, '--corp-dir', dir, '--output', output],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(join(skillDir, 'tools.json'), 'utf-8')).toBe(originalTools);
      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report).toEqual(expect.objectContaining({
        status: 'not-ready',
        reason: 'missing-write-tools',
        targetModified: false,
      }));
      expect(report.missingWriteTools).toEqual([
        'contract_intake',
        'create_service_record',
        'finance_settlement',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs Flow A and Flow B acceptance when the tenant has write tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-real-tenant-ready-'));
    const output = join(dir, 'readiness.json');
    try {
      makeTenant(dir);

      const result = spawnSync(
        'node',
        [scriptPath, '--corp-dir', dir, '--output', output],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report).toEqual(expect.objectContaining({
        status: 'passed',
        reason: 'ready',
        targetModified: false,
        missingWriteTools: [],
      }));
      expect(report.acceptance.artifactCounts).toEqual({
        contract_intakes: 1,
        maintenance_schedules: 1,
        service_incidents: 1,
        service_records: 1,
        finance_settlements: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
