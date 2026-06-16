import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAcmeMemoryAcceptance } from '../../src/acme-memory-acceptance.js';

describe('run-acme-memory-acceptance script', () => {
  it('writes and searches Acme Flow A / Flow B memories through MemoryManager', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-memory-acceptance-'));
    const dataDir = join(dir, 'data');
    const corpDir = join(dir, 'corp');
    try {
      const report = runAcmeMemoryAcceptance({
        dataDir,
        corpDir,
        tenant: 'acme-happycompany',
      });

      expect(report).toEqual(expect.objectContaining({
        status: 'passed',
        mode: 'memory-acceptance',
        tenant: 'acme-happycompany',
        targetModified: false,
      }));
      expect(report.employees.map((employee: { employeeId: string }) => employee.employeeId)).toEqual([
        'finance-wangwu',
        'maintenance-lisi',
      ]);
      for (const employee of report.employees as Array<{
        employeeId: string;
        sources: Array<{ file: string }>;
        searches: Array<{ results: unknown[] }>;
      }>) {
        expect(employee.sources.map((source) => source.file)).toContain('2026-06-04.md');
        expect(employee.searches.every((search) => search.results.length > 0)).toBe(true);
        expect(existsSync(join(
          corpDir,
          'acme-happycompany',
          'agents',
          employee.employeeId,
          'memory',
          '2026-06-04.md',
        ))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
