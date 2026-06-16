import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ToolRegistry } from '../../src/tool-registry.js';

const scriptPath = resolve(process.cwd(), 'scripts/prepare-acme-runtime-profile.mjs');
const sourceSkillDir = resolve(process.cwd(), 'corp/acme/.claude/skills/med_crm');

function makeTenantSource(root: string): string {
  const tenantDir = join(root, 'tenant-source');
  const skillDir = join(tenantDir, '.claude', 'skills', 'med_crm');
  mkdirSync(skillDir, { recursive: true });
  cpSync(sourceSkillDir, skillDir, { recursive: true });
  writeFileSync(join(tenantDir, 'app.json'), JSON.stringify({ name: 'acme-happycompany' }), 'utf-8');

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
  return tenantDir;
}

describe('prepare-acme-runtime-profile script', () => {
  it('creates an isolated runtime profile whose corp is scannable by ToolRegistry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-runtime-profile-test-'));
    const runtimeRoot = join(dir, '.runtime');
    const output = join(dir, 'report.json');
    try {
      const tenantSourceDir = makeTenantSource(dir);
      const originalTools = readFileSync(join(tenantSourceDir, '.claude', 'skills', 'med_crm', 'tools.json'), 'utf-8');

      const result = spawnSync(
        'node',
        [
          scriptPath,
          '--profile',
          'acme-test-profile',
          '--runtime-root',
          runtimeRoot,
          '--tenant-source-dir',
          tenantSourceDir,
          '--source-skill-dir',
          sourceSkillDir,
          '--output',
          output,
        ],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(join(tenantSourceDir, '.claude', 'skills', 'med_crm', 'tools.json'), 'utf-8')).toBe(originalTools);

      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report).toEqual(expect.objectContaining({
        status: 'passed',
        mode: 'runtime-profile',
        profile: 'acme-test-profile',
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
      expect(report.registry).toEqual(expect.objectContaining({
        status: 'passed',
        tenant: 'acme-happycompany',
        toolCount: 12,
      }));
      expect(report.registry.tools).toEqual([
        { name: 'med_crm:contract_intake', found: true },
        { name: 'med_crm:create_service_record', found: true },
        { name: 'med_crm:finance_settlement', found: true },
      ]);

      const registry = new ToolRegistry(report.corpDir);
      registry.scan();
      expect(registry.lookup('acme-happycompany', 'med_crm:contract_intake')).toBeDefined();
      expect(registry.lookup('acme-happycompany', 'med_crm:create_service_record')).toBeDefined();
      expect(registry.lookup('acme-happycompany', 'med_crm:finance_settlement')).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
