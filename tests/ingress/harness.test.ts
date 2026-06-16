import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageStore } from '../../src/store.js';
import { MessageBus } from '../../src/bus.js';
import { MessageIngressRuntime } from '../../src/ingress/runtime.js';
import type { AgentFactory } from '../../src/bot.js';
import type { RuntimeProfile } from '../../src/runtime-profile.js';
import {
  loadCaseFromYaml,
  loadCaseFromFile,
  runHarnessCase,
} from '../../src/ingress/adapters/harness.js';

const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'harness');

function makeReplyAgent(reply: string): AgentFactory {
  return {
    async respond() {
      return reply;
    },
    clearSession: () => true,
    clearAllSessions: () => 0,
    listSessions: () => [],
  };
}

function setupRuntime(agent: AgentFactory) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-'));
  const store = new MessageStore(join(dir, 'h.db'));
  const bus = new MessageBus();
  const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });
  return { runtime, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('harness adapter', () => {
  it('loads and runs echo-basic fixture — passes when reply contains keyword', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'echo-basic.yaml'));
    const { runtime, cleanup } = setupRuntime(
      makeReplyAgent('我是数字员工，可以协助你处理销售、服务和合规相关的工作。'),
    );
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('passed');
      expect(result.failures).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('reports failed expectations when reply is missing required substrings', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'reply-contains.yaml'));
    const { runtime, cleanup } = setupRuntime(makeReplyAgent('与浙一医院无关的内容'));
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('failed');
      const ids = result.failures.map((f) => f.expectation);
      expect(ids.some((id) => id.includes('维保'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('passes no-handoff-and-no-tool when nothing in the trace fires', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'no-handoff-and-no-tool.yaml'));
    const { runtime, cleanup } = setupRuntime(makeReplyAgent('天气我不知道'));
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('passed');
    } finally {
      cleanup();
    }
  });

  it('flags forbidden tool when the agent calls it', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'no-handoff-and-no-tool.yaml'));
    const noisyAgent: AgentFactory = {
      async respond(_prompt, _chatId, _botName, opts) {
        opts?.onToolStart?.({ toolName: 'med_crm:global_search', toolUseId: 'u-1' });
        opts?.onToolEnd?.({ toolName: 'med_crm:global_search', toolUseId: 'u-1', elapsedMs: 1 });
        return '天气不知道';
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };
    const { runtime, cleanup } = setupRuntime(noisyAgent);
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('failed');
      expect(result.failures.some((f) => f.expectation.includes('med_crm:global_search'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('asserts memory operations, handoff chain, and business artifacts', async () => {
    const yaml = [
      'id: acme-artifact-trace',
      'input:',
      '  channel: harness',
      '  botName: sales-zhangsan',
      '  tenant: acme-happycompany',
      '  userId: acme-operator',
      '  chatId: chat-acme-artifact-trace',
      '  text: 跑通示例医疗合同到维修回执链路',
      'expect:',
      '  replyContains:',
      '    - 回执',
      '  memoryOperations:',
      '    - operation: append',
      '      subjectContains: jsrm-540ct',
      '      workspaceContains: sales-zhangsan',
      '  handoffChain:',
      '    - from: sales-zhangsan',
      '      to: finance-wangwu',
      '      reasonContains: 合同',
      '    - from: finance-wangwu',
      '      to: maintenance-lisi',
      '      reasonContains: 维保',
      '    - from: maintenance-lisi',
      '      to: finance-wangwu',
      '      reasonContains: 回执',
      '  businessArtifactsCreated:',
      '    - contract_intake',
      '    - maintenance_schedule',
      '    - service_record',
      '  businessArtifactIdsInclude:',
      '    - jsrm-540ct-full-service',
      '    - schedule-jsrm-540ct-2026h2',
      '    - sr-jsrm-540ct-001',
      '  noErrors: true',
    ].join('\n');
    const testCase = loadCaseFromYaml(yaml, 'acme-artifact-trace.yaml');
    const agent: AgentFactory = {
      async respond(_prompt, _chatId, _botName, opts) {
        opts?.onMemoryOp?.({
          operation: 'append',
          subject: 'contract:jsrm-540ct-full-service',
          workspace: '/corp/acme-happycompany/agents/sales-zhangsan/memory',
        });
        opts?.onHandoff?.({ from: 'sales-zhangsan', to: 'finance-wangwu', reason: '合同中标后财务录入' });
        opts?.onBusinessArtifact?.({
          type: 'contract_intake',
          id: 'jsrm-540ct-full-service',
          status: 'created',
        });
        opts?.onBusinessArtifact?.({
          type: 'maintenance_schedule',
          id: 'schedule-jsrm-540ct-2026h2',
          status: 'created',
        });
        opts?.onHandoff?.({ from: 'finance-wangwu', to: 'maintenance-lisi', reason: '维保定时任务派单' });
        opts?.onBusinessArtifact?.({
          type: 'service_record',
          id: 'sr-jsrm-540ct-001',
          status: 'created',
        });
        opts?.onHandoff?.({ from: 'maintenance-lisi', to: 'finance-wangwu', reason: '回执交回财务结算' });
        return '合同、维保计划和 SERVICE RECORD 回执都已形成。';
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };
    const { runtime, cleanup } = setupRuntime(agent);
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('passed');
      expect(result.ingress?.trace.businessArtifacts.map((artifact) => artifact.type)).toEqual([
        'contract_intake',
        'maintenance_schedule',
        'service_record',
      ]);
    } finally {
      cleanup();
    }
  });

  it('captures agent thrown errors as error status, not failed assertions', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'echo-basic.yaml'));
    const failing: AgentFactory = {
      async respond() {
        throw new Error('boom');
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };
    const { runtime, cleanup } = setupRuntime(failing);
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.status).toBe('error');
      expect(result.error).toContain('boom');
    } finally {
      cleanup();
    }
  });

  it('resolves runtime profile input and asserts session metadata', async () => {
    const yaml = [
      'id: runtime-profile-web-default',
      'input:',
      '  channel: harness',
      '  botName: legacy-web-entry',
      '  tenant: tenant-a',
      '  userId: user-sales',
      '  chatId: chat-runtime-harness',
      '  text: 查一下客户进度',
      '  runtime:',
      '    tenant: tenant-a',
      '    entryId: web-bot',
      '    actorId: user-sales',
      '    target:',
      '      employeeId: sales-zhangsan',
      'expect:',
      '  replyContains:',
      '    - 客户进度',
      '  runtime:',
      '    tenant: tenant-a',
      '    entryId: web-bot',
      '    actorId: user-sales',
      '    employeeId: sales-zhangsan',
      '    instanceId: tenant-a:user-sales:sales-zhangsan',
      '    sdkSessionScope: tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-harness',
      '    workdirContains: agents/sales-zhangsan/user-sales',
      '    mode: single_employee',
      '  noErrors: true',
    ].join('\n');
    const testCase = loadCaseFromYaml(yaml, 'runtime-profile-web-default.yaml');
    let observedBotName = '';
    const agent: AgentFactory = {
      async respond(_prompt, _chatId, botName) {
        observedBotName = botName;
        return '客户进度已经整理完成。';
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };
    const { runtime, store, cleanup } = setupRuntime(agent);
    const profile: RuntimeProfile = {
      tenant: 'tenant-a',
      entry: {
        id: 'web-bot',
        tenant: 'tenant-a',
        channel: 'web',
        displayName: 'Web Bot',
        routingMode: 'direct',
        enabled: true,
      },
      actor: {
        tenant: 'tenant-a',
        actorId: 'user-sales',
        source: 'people',
        displayName: 'Sales User',
        peopleUserId: 'user-sales',
        bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }],
      },
      employee: {
        id: 'sales-zhangsan',
        displayName: '销售张三',
        description: '',
        model: '',
        systemPrompt: '',
        maxTurns: 50,
        tools: [],
        skills: [],
        workspace: 'agents/sales-zhangsan',
        role: 'sales',
        allowedTargets: [],
        capabilities: [],
        source: 'prepopulated',
        createdAt: 1,
      },
      instance: {
        tenant: 'tenant-a',
        employeeId: 'sales-zhangsan',
        actorId: 'user-sales',
        instanceId: 'tenant-a:user-sales:sales-zhangsan',
        workdir: '/tmp/tenant-a/agents/sales-zhangsan/user-sales',
        sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-harness',
        source: 'published_employee',
      },
      instructions: { systemPrompt: '', rules: [], handoffConditions: [] },
      tools: { allowed: [], denied: [], riskWarnings: [] },
      skills: [],
      memory: {
        namespace: 'tenant-a:user-sales:sales-zhangsan',
        workdir: '/tmp/tenant-a/agents/sales-zhangsan/user-sales',
      },
    };
    try {
      const result = await runHarnessCase(runtime, testCase, {
        runtimeResolver: {
          resolve(input) {
            expect(input).toMatchObject({
              tenant: 'tenant-a',
              entryId: 'web-bot',
              actorId: 'user-sales',
              target: { employeeId: 'sales-zhangsan' },
            });
            return profile;
          },
        },
      });
      expect(result.status).toBe('passed');
      expect(observedBotName).toBe('sales-zhangsan');
      expect(result.ingress?.trace.input.channel).toBe('web');
      expect(result.ingress?.trace.runtime).toMatchObject({
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        employeeId: 'sales-zhangsan',
      });
      expect(store.getRuntimeSession(profile.instance.sdkSessionScope)).toMatchObject({
        id: profile.instance.sdkSessionScope,
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        employeeId: 'sales-zhangsan',
        workdir: profile.instance.workdir,
      });
    } finally {
      cleanup();
    }
  });

  it('fixture directory has at least 3 cases (spec Done criterion)', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});
