import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/run-acme-shadow-tenant-acceptance.mjs');
const sourceSkillDir = resolve(process.cwd(), 'corp/acme/.claude/skills/med_crm');

function removeWriteTools(targetSkillDir: string): void {
  const toolsPath = join(targetSkillDir, 'tools.json');
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

describe('run-acme-shadow-tenant-acceptance script', () => {
  it('runs acceptance against a temporary overlay without modifying the target skill package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-shadow-test-'));
    const targetSkillDir = join(dir, 'target-med-crm');
    const output = join(dir, 'shadow-report.json');
    try {
      cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
      removeWriteTools(targetSkillDir);
      const originalTools = readFileSync(join(targetSkillDir, 'tools.json'), 'utf-8');

      const result = spawnSync(
        'node',
        [
          scriptPath,
          '--source-skill-dir',
          sourceSkillDir,
          '--target-skill-dir',
          targetSkillDir,
          '--output',
          output,
        ],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(join(targetSkillDir, 'tools.json'), 'utf-8')).toBe(originalTools);

      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report).toEqual(expect.objectContaining({
        status: 'passed',
        mode: 'shadow-tenant',
        targetModified: false,
      }));
      expect(report.stage.action).toBe('applied');
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
