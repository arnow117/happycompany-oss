import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/run-acme-ultimate-acceptance.mjs');

describe('run-acme-ultimate-acceptance script', () => {
  it('runs Flow A and Flow B through the real med_crm CLI against an isolated DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-ultimate-test-'));
    const output = join(dir, 'report.json');
    try {
      const result = spawnSync(
        'node',
        [scriptPath, '--workdir', dir, '--output', output],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report.status).toBe('passed');
      expect(report.flows.map((flow: { id: string; status: string }) => [flow.id, flow.status])).toEqual([
        ['acme-bid-win-to-contract-intake', 'passed'],
        ['acme-maintenance-schedule-dispatch-to-receipt', 'passed'],
      ]);
      expect(report.flows[0].steps.map((step: { tool: string }) => step.tool)).toEqual([
        'search_bids',
        'contract_intake',
      ]);
      expect(report.flows[1].steps.map((step: { tool: string }) => step.tool)).toEqual([
        'add_incident',
        'create_service_record',
        'finance_settlement',
      ]);
      expect(report.artifactCounts).toEqual({
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
