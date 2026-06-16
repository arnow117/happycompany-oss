import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/stage-acme-med-crm-write-tools.mjs');

function writeSkillPackage(root: string, tools: string[], cliText = 'original cli\n'): string {
  const skillDir = join(root, '.claude', 'skills', 'med_crm');
  mkdirSync(join(skillDir, 'med_crm'), { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# med_crm\n', 'utf-8');
  writeFileSync(
    join(skillDir, 'tools.json'),
    JSON.stringify({
      name: 'med_crm',
      tools: tools.map((name) => ({
        name,
        description: name,
        riskLevel: name.includes('search') ? 'read' : 'internal_write',
        parameters: { type: 'object', properties: {} },
      })),
    }),
    'utf-8',
  );
  writeFileSync(join(skillDir, 'med_crm', 'cli.py'), cliText, 'utf-8');
  return skillDir;
}

function parseStdout(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('stage-acme-med-crm-write-tools script', () => {
  it('reports missing target write tools without modifying files in dry-run mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-med-crm-dry-'));
    try {
      const source = writeSkillPackage(dir + '-source', [
        'search_bids',
        'contract_intake',
        'create_service_record',
        'finance_settlement',
      ], 'source cli\n');
      const target = writeSkillPackage(dir + '-target', ['search_bids'], 'target cli\n');

      const result = spawnSync(
        'node',
        [scriptPath, '--source-skill-dir', source, '--target-skill-dir', target],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      const report = parseStdout(result.stdout);
      expect(report.action).toBe('dry-run-only');
      expect(report.missingInTarget).toEqual([
        'contract_intake',
        'create_service_record',
        'finance_settlement',
      ]);
      expect(readFileSync(join(target, 'med_crm', 'cli.py'), 'utf-8')).toBe('target cli\n');
    } finally {
      rmSync(dir + '-source', { recursive: true, force: true });
      rmSync(dir + '-target', { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backs up and copies the source package when --apply is explicit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-med-crm-apply-'));
    try {
      const source = writeSkillPackage(dir + '-source', [
        'search_bids',
        'contract_intake',
        'create_service_record',
        'finance_settlement',
      ], 'source cli\n');
      const target = writeSkillPackage(dir + '-target', ['search_bids'], 'target cli\n');

      const result = spawnSync(
        'node',
        [scriptPath, '--source-skill-dir', source, '--target-skill-dir', target, '--apply'],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      const report = parseStdout(result.stdout);
      expect(report.action).toBe('applied');
      expect(String(report.backupDir)).toContain(join('med_crm', '.backups', 'backup-'));
      expect(readFileSync(join(target, 'med_crm', 'cli.py'), 'utf-8')).toBe('source cli\n');
      expect(report.targetToolsAfter).toEqual([
        'search_bids',
        'contract_intake',
        'create_service_record',
        'finance_settlement',
      ]);
    } finally {
      rmSync(dir + '-source', { recursive: true, force: true });
      rmSync(dir + '-target', { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
