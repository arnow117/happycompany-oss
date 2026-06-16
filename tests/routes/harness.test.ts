import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFactory } from '../../src/bot.js';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';
import { MessageBus } from '../../src/bus.js';
import { registerHarnessRoutes } from '../../src/routes/harness.js';
import { StepRunStore } from '../../src/harness/step-run-store.js';
import { MessageStore } from '../../src/store.js';

describe('harness admin routes', () => {
  let dir: string;
  let app: Hono;
  let stepRunStore: StepRunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-routes-'));
    const fixtureDir = join(dir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, 'route-real-runtime.yaml'),
      [
        'id: route-real-runtime',
        'input:',
        '  channel: harness',
        '  botName: acme-dingtalk',
        '  tenant: acme',
        '  userId: user-1',
        '  chatId: harness-route-real',
        '  text: 查一下浙一医院维保合同',
        'expect:',
        '  routedEmployee: sales-zhangsan',
        '  replyContains:',
        '    - 维保',
        '  noErrors: true',
      ].join('\n'),
      'utf-8',
    );
    const corpDir = join(dir, 'corp');
    const tenantDir = join(corpDir, 'tenant-a');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(
      join(tenantDir, 'people.json'),
      JSON.stringify([
        {
          userId: 'user-sales',
          name: 'Sales User',
          departments: [{ id: 'sales', name: 'Sales' }],
          status: 'active',
          source: 'manual',
          syncedAt: 1,
          updatedAt: 1,
          entryEmployee: 'sales-zhangsan',
          routingMode: 'bound',
          visibleEmployees: [],
        },
      ]),
      'utf-8',
    );
    const store = new MessageStore(join(dir, 'messages.db'));
    const bus = new MessageBus();
    const salesEmployee: LoadedEmployee = {
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
      tenantName: 'tenant-a',
      filePath: join(tenantDir, 'employees', 'sales-zhangsan.yaml'),
      loadedAtMs: 1,
    };
    const agentFactory: AgentFactory = {
      async respond(_prompt, _chatId, _botName, opts) {
        opts?.onRoutingDecision?.({
          mode: 'employee-director',
          selectedEmployee: 'sales-zhangsan',
        });
        return '已查询到浙一医院维保合同。';
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };

    app = new Hono();
    stepRunStore = new StepRunStore();
    registerHarnessRoutes(app, {
      agentFactory,
      store,
      bus,
      fixtureDir,
      stepRunStore,
      corpDir,
      configRef: {
        current: {
          bots: {
            'web-bot': {
              channel: 'web',
              tenant: 'tenant-a',
              agentDir: join(tenantDir, 'agents', 'entry'),
              displayName: 'Web Bot',
            },
          },
        },
      },
      employeeManager: {
        get(appId, tenantName) {
          if (appId === salesEmployee.id && tenantName === salesEmployee.tenantName) return { app: salesEmployee };
          return undefined;
        },
      },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a YAML case through MessageIngressRuntime', async () => {
    const yaml = [
      'id: route-real-runtime',
      'input:',
      '  channel: harness',
      '  botName: acme-dingtalk',
      '  tenant: acme',
      '  userId: user-1',
      '  chatId: harness-route-real',
      '  text: 查一下浙一医院维保合同',
      'expect:',
      '  routedEmployee: sales-zhangsan',
      '  replyContains:',
      '    - 维保',
      '  noErrors: true',
    ].join('\n');

    const res = await app.request('/api/admin/harness/run', {
      method: 'POST',
      body: JSON.stringify({ yaml, sourcePath: 'route-real-runtime.yaml' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      result: {
        status: string;
        ingress?: {
          trace: {
            input: { channel: string };
            routing: { selectedEmployee?: string };
          };
        };
      };
    };
    expect(body.result.status).toBe('passed');
    expect(body.result.ingress?.trace.input.channel).toBe('harness');
    expect(body.result.ingress?.trace.routing.selectedEmployee).toBe('sales-zhangsan');
  });

  it('returns 400 for invalid YAML case input', async () => {
    const res = await app.request('/api/admin/harness/run', {
      method: 'POST',
      body: JSON.stringify({ yaml: 'id: missing-input' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid harness case');
  });

  it('lists fixture cases without reading arbitrary paths', async () => {
    const res = await app.request('/api/admin/harness/cases');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      cases: Array<{ id: string; input: { channel: string }; expect: { routedEmployee?: string } }>;
    };
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({
      id: 'route-real-runtime',
      input: { channel: 'harness' },
      expect: { routedEmployee: 'sales-zhangsan' },
    });
  });

  it('filters fixture cases by tenant for product acceptance pages', async () => {
    writeFileSync(
      join(dir, 'fixtures', 'other-tenant.yaml'),
      [
        'id: other-tenant',
        'input:',
        '  channel: harness',
        '  botName: other-bot',
        '  tenant: acme-demo',
        '  chatId: other-chat',
        '  text: hello',
        'expect:',
        '  routedEmployee: other-bot',
      ].join('\n'),
      'utf-8',
    );

    const res = await app.request('/api/admin/harness/cases?tenant=acme');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      cases: Array<{ id: string; input: { tenant?: string } }>;
    };
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({ id: 'route-real-runtime', input: { tenant: 'acme' } });
  });

  it('runs a fixture suite and exposes the latest report', async () => {
    const runRes = await app.request('/api/admin/harness/run-suite', {
      method: 'POST',
      body: JSON.stringify({ caseIds: ['route-real-runtime'] }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      report: { summary: { passed: number; failed: number; total: number }; results: Array<{ status: string }> };
    };
    expect(runBody.report.summary).toEqual({ passed: 1, failed: 0, total: 1 });
    expect(runBody.report.results[0].status).toBe('passed');

    const latestRes = await app.request('/api/admin/harness/reports/latest');
    expect(latestRes.status).toBe(200);
    const latestBody = await latestRes.json() as { report: { summary: { total: number } } | null };
    expect(latestBody.report?.summary.total).toBe(1);
  });

  it('runs a runtime profile case through RuntimeResolver and persists the resolved session', async () => {
    const yaml = [
      'id: runtime-profile-route',
      'input:',
      '  channel: harness',
      '  botName: legacy-entry',
      '  tenant: tenant-a',
      '  userId: user-sales',
      '  chatId: route-runtime-chat',
      '  text: 查一下客户进度',
      '  runtime:',
      '    tenant: tenant-a',
      '    entryId: web-bot',
      '    actorId: user-sales',
      '    target:',
      '      employeeId: sales-zhangsan',
      'expect:',
      '  replyContains:',
      '    - 维保',
      '  runtime:',
      '    tenant: tenant-a',
      '    entryId: web-bot',
      '    actorId: user-sales',
      '    employeeId: sales-zhangsan',
      '    sdkSessionScope: tenant-a:web-bot:user-sales:sales-zhangsan:route-runtime-chat',
      '    workdirContains: tenant-a/agents/sales-zhangsan/user-sales',
      '    mode: single_employee',
      '  noErrors: true',
    ].join('\n');

    const res = await app.request('/api/admin/harness/run', {
      method: 'POST',
      body: JSON.stringify({ yaml, sourcePath: 'runtime-profile-route.yaml' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      result: {
        status: string;
        ingress?: {
          trace: {
            input: { channel: string; botName: string };
            runtime?: {
              employeeId?: string;
              sdkSessionScope?: string;
              workdir?: string;
            };
          };
        };
      };
    };
    expect(body.result.status).toBe('passed');
    expect(body.result.ingress?.trace.input).toMatchObject({ channel: 'web', botName: 'sales-zhangsan' });
    expect(body.result.ingress?.trace.runtime).toMatchObject({
      employeeId: 'sales-zhangsan',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:route-runtime-chat',
    });
  });

  it('runs and lists StepRun state through MessageIngressRuntime', async () => {
    const res = await app.request('/api/admin/harness/run-step', {
      method: 'POST',
      body: JSON.stringify({
        workflowRunId: 'wf-real',
        stepId: 'lookup',
        employeeId: 'acme-dingtalk',
        tenant: 'acme',
        userId: 'user-1',
        prompt: '查一下浙一医院维保合同',
        expectedArtifacts: ['维保'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { run: { status: string; input: { workflowRunId: string }; reply?: string } };
    expect(body.run.status).toBe('SUCCEEDED');
    expect(body.run.input.workflowRunId).toBe('wf-real');
    expect(body.run.reply).toContain('维保');

    const listRes = await app.request('/api/admin/harness/step-runs?workflowRunId=wf-real');
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { runs: Array<{ status: string; input: { stepId: string } }> };
    expect(listBody.runs).toHaveLength(1);
    expect(listBody.runs[0]).toMatchObject({ status: 'SUCCEEDED', input: { stepId: 'lookup' } });
    expect(stepRunStore.listByWorkflow('wf-real')).toHaveLength(1);
  });

  it('runs a StepRun with runtime profile input', async () => {
    const res = await app.request('/api/admin/harness/run-step', {
      method: 'POST',
      body: JSON.stringify({
        workflowRunId: 'wf-runtime',
        stepId: 'lookup',
        prompt: '查一下客户进度',
        expectedArtifacts: ['维保'],
        chatId: 'step-runtime-chat',
        runtime: {
          tenant: 'tenant-a',
          entryId: 'web-bot',
          actorId: 'user-sales',
          target: { employeeId: 'sales-zhangsan' },
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      run: {
        status: string;
        trace?: {
          input: { channel: string; botName: string };
          runtime?: { employeeId?: string; sdkSessionScope?: string };
        };
      };
    };
    expect(body.run.status).toBe('SUCCEEDED');
    expect(body.run.trace?.input).toMatchObject({ channel: 'web', botName: 'sales-zhangsan' });
    expect(body.run.trace?.runtime).toMatchObject({
      employeeId: 'sales-zhangsan',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:step-runtime-chat',
    });
  });
});
