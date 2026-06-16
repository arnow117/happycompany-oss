import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/run-acme-acceptance-suite.mjs');

describe('run-acme-acceptance-suite script', () => {
  it('aggregates Acme acceptance evidence and reports the real tenant ready state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-acceptance-suite-'));
    const output = join(dir, 'suite.json');
    const reportDir = join(dir, 'reports');
    try {
      // Point the real-tenant readiness check at the in-repo demo fixture
      // (corp/acme) so the suite is self-contained and does not depend on a
      // private external customer tenant.
      const corpDir = resolve(process.cwd(), 'corp');
      const result = spawnSync(
        'node',
        [
          scriptPath,
          '--report-dir', reportDir,
          '--output', output,
          '--corp-dir', corpDir,
          '--tenant', 'acme',
        ],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(output, 'utf-8'));
      expect(report).toEqual(expect.objectContaining({
        status: 'passed',
        targetModified: false,
      }));
      expect(report.summary.cliAcceptance.status).toBe('passed');
      expect(report.summary.shadowTenant.status).toBe('passed');
      expect(report.summary.shadowTenant.missingWriteTools).toEqual([]);
      expect(report.summary.shadowTenant.missingBeforeOverlay).toEqual([]);
      expect(report.summary.runtimeProfile.status).toBe('passed');
      expect(report.summary.memory.status).toBe('passed');
      expect(report.summary.realTenantReadiness).toEqual(expect.objectContaining({
        status: 'passed',
        reason: 'ready',
        targetModified: false,
        missingWriteTools: [],
      }));
      expect(report.nextGate).toBe('real-tenant-ready');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
