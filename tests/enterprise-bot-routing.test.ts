import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotConfig } from '../src/types.js';
import {
  resolveEnterpriseEntryAgent,
  type EmployeeDirectory,
} from '../src/enterprise-routing.js';
import { EmployeeManager } from '../src/orchestrator/employee-colony.js';
import { EnterprisePeopleStore } from '../src/enterprise-people.js';

function makeEmployeeDirectory(
  ids: string[],
  bindings: Record<string, { id: string; tenantName: string }> = {},
): EmployeeDirectory {
  return {
    has: (id: string) => ids.includes(id),
    findByHumanUserId: (tenant: string, userId: string) => {
      const employee = bindings[userId];
      return employee?.tenantName === tenant ? employee.id : null;
    },
  };
}

function makeBot(overrides: Partial<BotConfig>): BotConfig {
  return {
    name: 'acme-dingtalk',
    channel: 'dingtalk',
    credentials: {},
    displayName: '示例医疗助手',
    agentDir: '../corp/acme',
    cwd: '../corp/acme',
    ...overrides,
  };
}

describe('enterprise bot routing', () => {
  it('routes a known human user to their personal assistant', () => {
    const bot = makeBot({
      tenant: 'acme',
      routingMode: 'employee-director',
    });

    const employees = makeEmployeeDirectory(
      ['sales-zhaoliu'],
      { '353857515038293678': { id: 'sales-zhaoliu', tenantName: 'acme' } },
    );

    expect(resolveEnterpriseEntryAgent(bot, employees, '353857515038293678')).toBe('sales-zhaoliu');
  });

  it('returns null when user has no personal binding (no dispatcher fallback)', () => {
    const bot = makeBot({
      tenant: 'acme',
      routingMode: 'employee-director',
    });

    const employees = makeEmployeeDirectory(['sales-zhaoliu']);

    expect(resolveEnterpriseEntryAgent(bot, employees, 'unbound-user')).toBeNull();
  });

  it('preserves DingTalk user lookup via enterprise people assistant binding', () => {
    const corpDir = mkdtempSync(join(tmpdir(), 'enterprise-routing-people-'));
    try {
      const people = new EnterprisePeopleStore(corpDir);
      people.sync('acme', [
        { userId: 'ding-user-1', name: '赵六', departments: [{ id: '1', name: '示例医疗' }] },
      ]);
      people.bindAssistant('acme', 'ding-user-1', { entryEmployee: 'sales-zhangsan', routingMode: 'bound', visibleEmployees: ['sales-zhangsan'] });

      const employees = new EmployeeManager({
        corpDir,
        dataDir: '/data',
        createAgent: () => ({ respond: async () => 'ok' }) as never,
        skillBridge: { buildMcpServer: () => ({ name: 'skill-tools', version: '1.0.0' }) } as never,
      });
      employees.register({
        id: 'sales-zhangsan',
        displayName: '销售张三',
        description: '',
        model: '',
        systemPrompt: '',
        maxTurns: 50,
        tools: [],
        skills: [],
        workspace: '',
        role: 'sales',
        allowedTargets: [],
        capabilities: [],
        tenantName: 'acme',
        filePath: '/corp/acme/employees/sales-zhangsan.yaml',
        loadedAtMs: Date.now(),
      });

      const bot = makeBot({
        tenant: 'acme',
        routingMode: 'employee-director',
      });

      expect(resolveEnterpriseEntryAgent(bot, employees, 'ding-user-1')).toBe('sales-zhangsan');
    } finally {
      rmSync(corpDir, { recursive: true, force: true });
    }
  });

  it('passes the incoming prompt when resolving role-specific people bindings', () => {
    const bot = makeBot({
      tenant: 'acme',
      routingMode: 'employee-director',
    });
    const employees: EmployeeDirectory = {
      has: (id) => ['maintenance-lisi'].includes(id),
      findByHumanUserId: (_tenant, _userId, prompt) => prompt?.includes('维修') ? 'maintenance-lisi' : null,
    };

    expect(resolveEnterpriseEntryAgent(bot, employees, 'ding-user-2', '设备需要维修')).toBe('maintenance-lisi');
  });

  it('does not route ordinary bots through enterprise routing', () => {
    const bot = makeBot({ tenant: 'acme' });

    expect(resolveEnterpriseEntryAgent(bot, makeEmployeeDirectory(['sales-zhangsan']))).toBeNull();
  });

  it('returns null for direct routingMode even with binding', () => {
    const bot = makeBot({
      tenant: 'acme',
      routingMode: 'direct',
    });

    const employees = makeEmployeeDirectory(
      ['sales-zhangsan'],
      { 'user-1': { id: 'sales-zhangsan', tenantName: 'acme' } },
    );

    expect(resolveEnterpriseEntryAgent(bot, employees, 'user-1')).toBeNull();
  });
});
