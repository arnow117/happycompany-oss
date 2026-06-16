import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ToolRegistry } from '../../src/tool-registry.js';
import { employeeDefinitionSchema } from '../../src/orchestrator/employee-schema.js';
import { AgentDraftFactory } from '../../src/agent-builder/draft-factory.js';
import { AgentDraftValidator } from '../../src/agent-builder/validator.js';
import { buildHarnessYamlForDraft } from '../../src/agent-builder/harness-builder.js';
import { sanitizeDraftId, sanitizeEmployeeId } from '../../src/agent-builder/schema.js';
import { loadCaseFromYaml } from '../../src/ingress/adapters/harness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = resolve(HERE, '../fixtures/agent-builder/sandbox-corp');

async function withSandbox<T>(fn: (ctx: { root: string; corpDir: string; toolRegistry: ToolRegistry }) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'agent-builder-core-'));
  const corpDir = join(root, 'corp');
  cpSync(SANDBOX, corpDir, { recursive: true });
  const toolRegistry = new ToolRegistry(corpDir);
  toolRegistry.scan();
  try {
    return await fn({ root, corpDir, toolRegistry });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('agent builder core', () => {
  it('normalizes draft and employee ids into safe slugs', () => {
    expect(sanitizeDraftId('  Sales QA!!!  ')).toBe('sales-qa');
    expect(sanitizeEmployeeId('售后质检员工')).toMatch(/^draft-/);
  });

  it('creates all draft sources into the same AgentDraft shape', async () => {
    await withSandbox(async ({ corpDir }) => {
      const factory = new AgentDraftFactory({
        corpDir,
        findEmployee: (tenant, employeeId) => {
          const file = join(corpDir, tenant, 'employees', `${employeeId}.yaml`);
          return employeeDefinitionSchema.parse(parseYaml(readFileSync(file, 'utf-8')) as unknown);
        },
        listEmployees: () => [],
      });

      const natural = await factory.create({ source: 'natural_language', tenant: 'builder-demo', prompt: '创建一个售后质检员工，检查维修工单质量' });
      const manual = await factory.create({ source: 'manual', tenant: 'builder-demo' });
      const template = await factory.create({ source: 'template', tenant: 'builder-demo', templateId: 'med-device', role: 'maintenance-qa' });
      const fork = await factory.create({ source: 'fork', tenant: 'builder-demo', sourceEmployeeId: 'sales-zhangsan' });

      for (const draft of [natural, manual, template, fork]) {
        expect(draft.tenant).toBe('builder-demo');
        expect(draft.status).toBe('draft');
        expect(draft.employee.workspace).toContain(draft.employee.id);
      }
      expect(fork.employee.workspace).not.toBe('agents/sales-zhangsan');
      expect(fork.employee.humanUserId).toBeUndefined();
    });
  });

  it('validates safe workspaces and rejects references outside the sandbox tenant', async () => {
    await withSandbox(async ({ corpDir, toolRegistry }) => {
      const factory = new AgentDraftFactory({ corpDir });
      const draft = await factory.create({ source: 'natural_language', tenant: 'builder-demo', prompt: '创建一个售后质检员工，检查维修工单质量，赔付问题转财务' });
      const validator = new AgentDraftValidator({
        corpDir,
        toolRegistry,
        employeeExists: (_tenant, employeeId) => ['sales-zhangsan', 'maintenance-lisi', 'finance-wangwu'].includes(employeeId),
      });

      expect(validator.validate(draft).ok).toBe(true);
      const escaped = {
        ...draft,
        employee: { ...draft.employee, workspace: '../../outside' },
      };
      const escapedValidation = validator.validate(escaped);
      expect(escapedValidation.ok).toBe(false);
      expect(escapedValidation.issues.some((issue) => issue.field === 'employee.workspace')).toBe(true);
    });
  });

  it('builds a valid harness case from draft capabilities and tools', async () => {
    await withSandbox(async ({ corpDir }) => {
      const factory = new AgentDraftFactory({ corpDir });
      const draft = await factory.create({ source: 'natural_language', tenant: 'builder-demo', prompt: '创建一个售后质检员工，检查维修工单质量' });
      const yaml = buildHarnessYamlForDraft(draft);
      const testCase = loadCaseFromYaml(yaml);

      expect(testCase.id).toBe(`agent-builder-${draft.employee.id}`);
      expect(testCase.expect.routedEmployee).toBe(draft.employee.id);
      expect(testCase.expect.toolNamesIncludes).toEqual(['med_crm:list_maintenance']);
      expect(testCase.expect.noErrors).toBe(true);
    });
  });
});
