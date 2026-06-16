import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { DEFAULT_WEB_CHAT_CONFIG } from '../src/config.js';
import { RuntimeResolveError, RuntimeResolver, type RuntimeEmployeeDirectory, type RuntimeRegisteredEmployee } from '../src/runtime-resolver.js';
import type { LoadedEmployee } from '../src/orchestrator/employee-loader.js';
import type { RuntimeMessageInput } from '../src/runtime-profile.js';

class FixtureEmployeeDirectory implements RuntimeEmployeeDirectory {
  private readonly employees = new Map<string, RuntimeRegisteredEmployee>();

  add(employee: LoadedEmployee): void {
    this.employees.set(`${employee.tenantName}:${employee.id}`, { app: employee });
  }

  get(appId: string, tenantName?: string): RuntimeRegisteredEmployee | undefined {
    if (!tenantName) {
      for (const employee of this.employees.values()) {
        if (employee.app.id === appId) return employee;
      }
      return undefined;
    }
    return this.employees.get(`${tenantName}:${appId}`);
  }
}

function makeConfig(): Config {
  return {
    bots: {
      'web-bot': {
        channel: 'web',
        displayName: 'Web 入口',
        agentDir: 'agents/web-bot',
        tenant: 'tenant-a',
        routingMode: 'employee-director',
      },
      'ding-bot': {
        channel: 'dingtalk',
        displayName: '钉钉入口',
        agentDir: 'agents/ding-bot',
        tenant: 'tenant-a',
        routingMode: 'employee-director',
      },
      'other-web': {
        channel: 'web',
        displayName: '其他租户 Web',
        agentDir: 'agents/other-web',
        tenant: 'tenant-b',
        routingMode: 'employee-director',
      },
    },
    claude: undefined,
    web: { port: 3100 },
    webChat: DEFAULT_WEB_CHAT_CONFIG,
    dataDir: 'data',
    corpDir: undefined,
    adminToken: undefined,
  };
}

function makeEmployee(partial: Partial<LoadedEmployee> & { id: string; tenantName: string }): LoadedEmployee {
  return {
    id: partial.id,
    tenantName: partial.tenantName,
    displayName: partial.displayName ?? partial.id,
    description: partial.description ?? '',
    model: partial.model ?? 'claude-sonnet-4-6',
    systemPrompt: partial.systemPrompt ?? 'You are a helpful employee.',
    maxTurns: partial.maxTurns ?? 50,
    tools: partial.tools ?? [],
    skills: partial.skills ?? [],
    workspace: partial.workspace ?? `agents/${partial.id}`,
    role: partial.role ?? 'member',
    allowedTargets: partial.allowedTargets ?? [],
    capabilities: partial.capabilities ?? [],
    source: partial.source ?? 'prepopulated',
    createdAt: partial.createdAt ?? 1,
    filePath: partial.filePath ?? '',
    loadedAtMs: partial.loadedAtMs ?? 1,
    oneLiner: partial.oneLiner,
    humanUserId: partial.humanUserId,
  };
}

describe('RuntimeResolver', () => {
  let corpDir: string;
  let employees: FixtureEmployeeDirectory;
  let resolver: RuntimeResolver;

  beforeEach(() => {
    corpDir = mkdtempSync(join(tmpdir(), 'runtime-resolver-'));
    mkdirSync(join(corpDir, 'tenant-a'), { recursive: true });
    mkdirSync(join(corpDir, 'tenant-b'), { recursive: true });
    writeFileSync(join(corpDir, 'tenant-a', 'people.json'), JSON.stringify([
      {
        userId: 'user-sales-a',
        name: '销售 A',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
        entryEmployee: 'sales-zhangsan',
        routingMode: 'bound',
        visibleEmployees: [],
      },
      {
        userId: 'user-multi',
        name: '多绑定用户',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
        roleBindings: [
          { role: 'sales', assistantId: 'sales-zhangsan' },
          { role: 'finance', assistantId: 'finance-wangwu' },
        ],
      },
      {
        userId: 'user-unbound',
        name: '未绑定用户',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
      },
    ], null, 2), 'utf-8');
    writeFileSync(join(corpDir, 'tenant-b', 'people.json'), JSON.stringify([], null, 2), 'utf-8');

    employees = new FixtureEmployeeDirectory();
    employees.add(makeEmployee({
      id: 'sales-zhangsan',
      tenantName: 'tenant-a',
      displayName: '销售张三',
      role: 'sales',
      oneLiner: '查医院、查设备、记录销售活动',
    }));
    employees.add(makeEmployee({
      id: 'finance-wangwu',
      tenantName: 'tenant-a',
      displayName: '财务王五',
      role: 'finance',
    }));
    employees.add(makeEmployee({
      id: 'sales-zhangsan',
      tenantName: 'tenant-b',
      displayName: '其他租户销售',
    }));

    resolver = new RuntimeResolver({
      corpDir,
      config: makeConfig(),
      employeeManager: employees,
    });
  });

  afterEach(() => {
    rmSync(corpDir, { recursive: true, force: true });
  });

  it('lists entries scoped by tenant', () => {
    expect(resolver.listEntries('tenant-a').map((entry) => entry.id)).toEqual(['web-bot', 'ding-bot']);
    expect(resolver.listEntries('tenant-b').map((entry) => entry.id)).toEqual(['other-web']);
  });

  it('lists actors and their bindings from people.json', () => {
    const actors = resolver.listActors('tenant-a');
    expect(actors.map((actor) => actor.actorId)).toContain('user-sales-a');
    expect(actors.find((actor) => actor.actorId === 'user-sales-a')?.bindings).toEqual([
      { employeeId: 'sales-zhangsan', isDefault: true },
    ]);
    expect(actors.find((actor) => actor.actorId === 'user-multi')?.bindings).toEqual([
      { employeeId: 'sales-zhangsan', role: 'sales', isDefault: true },
      { employeeId: 'finance-wangwu', role: 'finance', isDefault: false },
    ]);
  });

  it('lists runtime targets for a bound actor', () => {
    const targets = resolver.listTargets('tenant-a', 'user-multi');
    expect(targets).toEqual([
      expect.objectContaining({ employeeId: 'sales-zhangsan', isDefault: true }),
      expect.objectContaining({ employeeId: 'finance-wangwu', isDefault: false }),
    ]);
  });

  it('resolves a RuntimeProfile with actor-scoped workdir and conversation-scoped sdk session', () => {
    const profile = resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales-a',
      chatId: 'chat-1',
      text: '你好',
    });

    expect(profile.entry.id).toBe('web-bot');
    expect(profile.actor.actorId).toBe('user-sales-a');
    expect(profile.employee.id).toBe('sales-zhangsan');
    expect(profile.instance.instanceId).toBe('tenant-a:user-sales-a:sales-zhangsan');
    expect(profile.instance.workdir).toBe(join(corpDir, 'tenant-a', 'agents', 'sales-zhangsan', 'user-sales-a'));
    expect(profile.instance.sdkSessionScope).toBe('tenant-a:web-bot:user-sales-a:sales-zhangsan:chat-1');
    expect(profile.memory.namespace).toBe('tenant-a:user-sales-a:sales-zhangsan');
  });

  it('keeps workdir scoped by actor while sdk session changes per chat', () => {
    const first = resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales-a',
      chatId: 'chat-1',
      text: 'first',
    });
    const second = resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales-a',
      chatId: 'chat-2',
      text: 'second',
    });

    expect(second.instance.workdir).toBe(first.instance.workdir);
    expect(second.instance.sdkSessionScope).not.toBe(first.instance.sdkSessionScope);
  });

  it('uses explicit employee target when actor has multiple bindings', () => {
    const profile = resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-multi',
      chatId: 'chat-1',
      text: '查发票',
      target: { employeeId: 'finance-wangwu' },
    });

    expect(profile.employee.id).toBe('finance-wangwu');
  });

  it('rejects unbound actors instead of creating a session silently', () => {
    expect(() => resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-unbound',
      chatId: 'chat-1',
      text: 'hello',
    })).toThrow(RuntimeResolveError);
    try {
      resolver.resolve({
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-unbound',
        chatId: 'chat-1',
        text: 'hello',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeResolveError);
      expect((err as RuntimeResolveError).code).toBe('binding_required');
    }
  });

  it('does not let caller-provided workdir influence resolved workdir', () => {
    const input: RuntimeMessageInput & { workdir: string } = {
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales-a',
      chatId: 'chat-1',
      text: 'hello',
      workdir: '/tmp/evil',
    };
    const profile = resolver.resolve(input);
    expect(profile.instance.workdir).toBe(join(corpDir, 'tenant-a', 'agents', 'sales-zhangsan', 'user-sales-a'));
  });

  it('rejects employee workspace outside tenant directory', () => {
    employees.add(makeEmployee({
      id: 'unsafe-employee',
      tenantName: 'tenant-a',
      workspace: '../../outside',
    }));
    writeFileSync(join(corpDir, 'tenant-a', 'people.json'), JSON.stringify([
      {
        userId: 'user-unsafe',
        name: '危险用户',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
        entryEmployee: 'unsafe-employee',
      },
    ], null, 2), 'utf-8');

    expect(() => resolver.resolve({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-unsafe',
      chatId: 'chat-1',
      text: 'hello',
    })).toThrow(RuntimeResolveError);
  });
});
