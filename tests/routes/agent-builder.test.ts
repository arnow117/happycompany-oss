import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { registerAgentBuilderRoutes } from '../../src/routes/agent-builder.js';
import { ToolRegistry } from '../../src/tool-registry.js';
import { EmployeeManager } from '../../src/orchestrator/employee-colony.js';
import { SkillBridge } from '../../src/orchestrator/skill-bridge.js';
import { AppServerMgr } from '../../src/app-server.js';
import type { ClaudeAgent } from '../../src/agent.js';
import type { AgentFactory } from '../../src/bot.js';
import { MessageBus } from '../../src/bus.js';
import { MessageStore } from '../../src/store.js';
import type { AgentDraft } from '../../src/agent-builder/schema.js';
import type { NaturalLanguageDraftGenerator } from '../../src/agent-builder/draft-factory.js';
import { employeeDefinitionSchema } from '../../src/orchestrator/employee-schema.js';
import type { EmployeeCapabilityReport } from '../../src/capability-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = resolve(HERE, '../fixtures/agent-builder/sandbox-corp');

interface TestCtx {
  root: string;
  corpDir: string;
  dataDir: string;
  app: Hono;
  manager: EmployeeManager;
  toolRegistry: ToolRegistry;
  store: MessageStore;
  agentFactory: AgentFactory;
}

function setup(generator?: NaturalLanguageDraftGenerator): TestCtx {
  const root = mkdtempSync(join(tmpdir(), 'agent-builder-routes-'));
  const corpDir = join(root, 'corp');
  const dataDir = join(root, 'data');
  cpSync(SANDBOX, corpDir, { recursive: true });

  const toolRegistry = new ToolRegistry(corpDir);
  toolRegistry.scan();
  const manager = new EmployeeManager({
    corpDir,
    dataDir,
    skillBridge: new SkillBridge({
      toolRegistry,
      appServerMgr: new AppServerMgr(),
      corpDir,
    }),
    createAgent: vi.fn(() => ({ respond: vi.fn() }) as unknown as ClaudeAgent),
  });
  const store = new MessageStore(join(dataDir, 'messages.db'));
  const agentFactory: AgentFactory = {
    respond: vi.fn(async (prompt: string) => `sandbox reply: ${prompt}`),
    clearSession: vi.fn(() => true),
    clearAllSessions: vi.fn(() => 0),
    listSessions: vi.fn(() => []),
  };

  const app = new Hono();
  registerAgentBuilderRoutes(app, {
    dataDir,
    corpDir,
    toolRegistry,
    employeeManager: manager,
    generator,
    agentFactory,
    store,
    bus: new MessageBus(),
  });
  return { root, corpDir, dataDir, app, manager, toolRegistry, store, agentFactory };
}

async function createDraft(ctx: TestCtx, body: unknown): Promise<AgentDraft> {
  const res = await ctx.app.request('/api/agent-builder/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const payload = await res.json() as { draft: AgentDraft };
  return payload.draft;
}

async function postDraftAction(ctx: TestCtx, draftId: string, action: string): Promise<Response> {
  return ctx.app.request(`/api/agent-builder/drafts/${draftId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sandboxDraft(ctx: TestCtx, draftId: string): Promise<AgentDraft> {
  const res = await ctx.app.request(`/api/agent-builder/drafts/${draftId}/sandbox/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorId: 'builder-user',
      chatId: `sandbox-${draftId}`,
      text: '发布前沙盒试聊',
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { draft: AgentDraft };
  expect(body.draft.sandbox?.lastResult).toBe('passed');
  return body.draft;
}

async function updateDraft(ctx: TestCtx, draft: AgentDraft): Promise<AgentDraft> {
  const res = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { draft: AgentDraft };
  return body.draft;
}

describe('agent builder routes', () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.store.close();
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('creates, validates, tests, and publishes a natural-language draft without writing outside sandbox', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量，赔付问题转财务',
    });
    expect(draft.source).toBe('natural_language');
    expect(draft.employee.id).toBe('maintenance-qa');
    expect(existsSync(join(ctx.corpDir, 'builder-demo', 'employees', 'maintenance-qa.yaml'))).toBe(false);

    const validateRes = await postDraftAction(ctx, draft.id, 'validate');
    expect(validateRes.status).toBe(200);
    const validateBody = await validateRes.json() as { draft: AgentDraft };
    expect(validateBody.draft.status).toBe('validated');

    const testRes = await postDraftAction(ctx, draft.id, 'test');
    expect(testRes.status).toBe(200);
    const testBody = await testRes.json() as { draft: AgentDraft };
    expect(testBody.draft.status).toBe('tested');
    expect(testBody.draft.harness?.lastResult).toBe('passed');
    await sandboxDraft(ctx, draft.id);

    const publishRes = await postDraftAction(ctx, draft.id, 'publish');
    expect(publishRes.status).toBe(200);
    const publishBody = await publishRes.json() as {
      draft: AgentDraft;
      yamlPath: string;
      workspacePath: string;
      colonyRegistered: boolean;
    };
    expect(publishBody.draft.status).toBe('published');
    expect(publishBody.yamlPath).toBe(join(ctx.corpDir, 'builder-demo', 'employees', 'maintenance-qa.yaml'));
    expect(existsSync(publishBody.yamlPath)).toBe(true);
    expect(existsSync(publishBody.workspacePath)).toBe(true);
    const claudeMdPath = join(publishBody.workspacePath, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);
    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    expect(claudeMd).toContain('售后质检员工');
    expect(claudeMd).toContain('检查维修工单质量');
    expect(claudeMd).toContain('med_crm');
    expect(claudeMd).toContain('finance-wangwu');
    expect(ctx.manager.has('maintenance-qa', 'builder-demo')).toBe(true);
    const parsed = parseYaml(readFileSync(publishBody.yamlPath, 'utf-8')) as unknown;
    expect(employeeDefinitionSchema.parse(parsed).id).toBe('maintenance-qa');
    expect(publishBody.yamlPath.startsWith(ctx.corpDir)).toBe(true);
  });

  it('creates a draft from a role template', async () => {
    const draft = await createDraft(ctx, {
      source: 'template',
      tenant: 'builder-demo',
      templateId: 'med-device',
      role: 'maintenance-qa',
    });
    expect(draft.employee.displayName).toBe('售后质检员工');
    expect(draft.employee.skills).toContain('med_crm');
    expect(draft.employee.allowedTargets).toContain('finance-wangwu');
  });

  it('runs draft sandbox messages through runtime conversation sessions', async () => {
    const draft = await createDraft(ctx, {
      source: 'template',
      tenant: 'builder-demo',
      templateId: 'med-device',
      role: 'maintenance-qa',
    });

    const res = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}/sandbox/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorId: 'builder-user',
        chatId: 'sandbox-chat-1',
        text: '帮我检查维修工单',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { draft: AgentDraft; session: { id: string; mode: string; workdir: string }; reply: string };
    expect(body.draft.sandbox).toEqual(expect.objectContaining({
      lastSessionId: expect.any(String),
      lastResult: 'passed',
      fingerprint: expect.any(String),
    }));
    expect(body.session).toEqual(expect.objectContaining({
      mode: 'builder_sandbox',
      tenant: 'builder-demo',
      entryId: `builder-sandbox:${draft.id}`,
      actorId: 'builder-user',
      employeeId: draft.employee.id,
      chatId: 'sandbox-chat-1',
    }));
    expect(body.reply).toContain('sandbox reply');
    expect(ctx.agentFactory.respond).toHaveBeenCalledWith(
      '帮我检查维修工单',
      'sandbox-chat-1',
      draft.employee.id,
      expect.objectContaining({
        tenant: 'builder-demo',
        userId: 'builder-user',
        runtimeAgentDir: body.session.workdir,
        runtimeCwd: body.session.workdir,
      }),
    );
    const claudeMd = readFileSync(join(body.session.workdir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain(draft.employee.displayName);
    expect(claudeMd).toContain(draft.employee.systemPrompt);

    const summaries = ctx.store.listRuntimeSessions({
      tenant: 'builder-demo',
      mode: 'builder_sandbox',
      includeArchived: true,
    });
    expect(summaries).toEqual([
      expect.objectContaining({
        id: body.session.id,
        messageCount: 2,
        preview: 'sandbox reply: 帮我检查维修工单',
      }),
    ]);
    expect(ctx.store.listMessagesForSession(body.session.id).map((message) => message.source)).toEqual(['user', 'bot']);
  });

  it('returns readable errors for malformed natural-language generator output without writing corp files', async () => {
    ctx.store.close();
    rmSync(ctx.root, { recursive: true, force: true });
    ctx = setup({
      generate: vi.fn(async () => ({
        id: 'broken-employee',
        displayName: 'Broken Employee',
        maxTurns: 0,
      })),
    });

    const res = await ctx.app.request('/api/agent-builder/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'natural_language',
        tenant: 'builder-demo',
        prompt: '生成一个非法草稿',
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('maxTurns');
    expect(existsSync(join(ctx.corpDir, 'builder-demo', 'employees', 'broken-employee.yaml'))).toBe(false);
  });

  it('creates a fork draft with a different workspace and no human binding', async () => {
    const draft = await createDraft(ctx, {
      source: 'fork',
      tenant: 'builder-demo',
      sourceEmployeeId: 'sales-zhangsan',
    });
    expect(draft.employee.id).toMatch(/^sales-zhangsan-fork-/);
    expect(draft.employee.workspace).toBe(`agents/${draft.employee.id}`);
    expect(draft.employee.workspace).not.toBe('agents/sales-zhangsan');
    expect(draft.employee.humanUserId).toBeUndefined();
  });

  it('blocks publish until validation, harness test, and runtime sandbox have passed', async () => {
    const draft = await createDraft(ctx, {
      source: 'manual',
      tenant: 'builder-demo',
    });
    const publishRes = await postDraftAction(ctx, draft.id, 'publish');
    expect(publishRes.status).toBe(409);

    const edited = await updateDraft(ctx, {
      ...draft,
      employee: {
        ...draft.employee,
        id: 'policy-reader',
        displayName: '制度问答员工',
        role: 'member',
        systemPrompt: '回答企业制度问题，不调用业务工具。',
        skills: [],
        tools: [],
        workspace: 'agents/policy-reader',
      },
    });
    await postDraftAction(ctx, edited.id, 'validate');
    await postDraftAction(ctx, edited.id, 'test');
    const missingSandbox = await postDraftAction(ctx, edited.id, 'publish');
    expect(missingSandbox.status).toBe(409);
    expect((await missingSandbox.json() as { error: string }).error).toContain('sandboxed');
  });

  it('returns 400/404 for invalid create bodies and missing source records', async () => {
    const missingTenant = await ctx.app.request('/api/agent-builder/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'manual' }),
    });
    expect(missingTenant.status).toBe(400);

    const missingPrompt = await ctx.app.request('/api/agent-builder/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'natural_language', tenant: 'builder-demo' }),
    });
    expect(missingPrompt.status).toBe(400);

    const missingTemplate = await ctx.app.request('/api/agent-builder/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'template', tenant: 'builder-demo', templateId: 'missing-template', role: 'sales' }),
    });
    expect(missingTemplate.status).toBe(404);

    const missingForkSource = await ctx.app.request('/api/agent-builder/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fork', tenant: 'builder-demo', sourceEmployeeId: 'missing-employee' }),
    });
    expect(missingForkSource.status).toBe(404);
  });

  it('supports list, get, put, and 404 behavior for draft resources', async () => {
    const draft = await createDraft(ctx, { source: 'manual', tenant: 'builder-demo' });

    const listRes = await ctx.app.request('/api/agent-builder/drafts');
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { drafts: AgentDraft[] };
    expect(listBody.drafts.map((item) => item.id)).toContain(draft.id);

    const getRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { draft: AgentDraft };
    expect(getBody.draft.id).toBe(draft.id);

    const edited = await updateDraft(ctx, {
      ...draft,
      employee: { ...draft.employee, displayName: '编辑后的员工' },
    });
    expect(edited.employee.displayName).toBe('编辑后的员工');
    expect(edited.status).toBe('draft');

    const missingGet = await ctx.app.request('/api/agent-builder/drafts/missing');
    expect(missingGet.status).toBe(404);
    const missingPut = await ctx.app.request('/api/agent-builder/drafts/missing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    expect(missingPut.status).toBe(404);
  });

  it('previews draft capability assembly before publish', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量，赔付问题转财务',
    });

    const res = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}/capabilities`);
    expect(res.status).toBe(200);
    const body = await res.json() as { capability: EmployeeCapabilityReport };
    expect(body.capability.employeeId).toBe('maintenance-qa');
    expect(body.capability.skills.map((skill) => skill.name)).toContain('med_crm');
    expect(body.capability.tools.map((tool) => tool.name)).toContain('med_crm:list_maintenance');
    expect(body.capability.handoffTargets.map((target) => target.employeeId)).toContain('finance-wangwu');
    expect(body.capability.mcpBoundary.businessInterface).toBe('run_skill');

    const missing = await ctx.app.request('/api/agent-builder/drafts/missing/capabilities');
    expect(missing.status).toBe(404);
  });

  it('returns tenant options for structured skill, tool, and target selectors', async () => {
    const res = await ctx.app.request('/api/agent-builder/options?tenant=builder-demo');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      skills: Array<{ name: string }>;
      tools: Array<{ name: string; riskLevel: string }>;
      employees: Array<{ id: string; role: string }>;
    };

    expect(body.skills.map((item) => item.name)).toEqual(expect.arrayContaining(['human-acceptance', 'med_crm']));
    expect(body.tools.map((item) => item.name)).toContain('med_crm:list_maintenance');
    expect(body.tools.find((item) => item.name === 'med_crm:delete_contract')?.riskLevel).toBe('destructive');
    expect(body.employees.map((item) => item.id)).toEqual(expect.arrayContaining(['sales-zhangsan', 'maintenance-lisi', 'finance-wangwu']));

    const missingTenant = await ctx.app.request('/api/agent-builder/options');
    expect(missingTenant.status).toBe(400);
  });

  it('reports validation errors for unknown tools, cross-targets, and escaping workspace', async () => {
    const draft = await createDraft(ctx, {
      source: 'manual',
      tenant: 'builder-demo',
    });
    const edited: AgentDraft = {
      ...draft,
      employee: {
        ...draft.employee,
        id: 'bad-employee',
        role: 'maintenance',
        systemPrompt: '负责测试非法配置',
        skills: ['missing_skill'],
        tools: ['med_crm:missing_tool'],
        allowedTargets: ['unknown-employee'],
        workspace: '../outside',
      },
    };
    const updateRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edited),
    });
    expect(updateRes.status).toBe(200);

    const validateRes = await postDraftAction(ctx, draft.id, 'validate');
    const body = await validateRes.json() as { validation: { ok: boolean; issues: Array<{ field: string; message: string }> } };
    expect(body.validation.ok).toBe(false);
    const messages = body.validation.issues.map((item) => `${item.field}:${item.message}`).join('\n');
    expect(messages).toContain('Skill does not exist');
    expect(messages).toContain('Tool is not registered');
    expect(messages).toContain('Handoff target does not exist');
    expect(messages).toContain('Workspace must');
  });

  it('reports id conflicts, empty prompts, absolute workspace escapes, and high-risk warnings', async () => {
    const draft = await createDraft(ctx, { source: 'manual', tenant: 'builder-demo' });
    await updateDraft(ctx, {
      ...draft,
      employee: {
        ...draft.employee,
        id: 'sales-zhangsan',
        displayName: '冲突员工',
        role: 'maintenance',
        systemPrompt: '',
        skills: ['med_crm'],
        tools: ['med_crm:add_incident'],
        workspace: '/tmp/outside-agent-builder',
      },
    });

    const validateRes = await postDraftAction(ctx, draft.id, 'validate');
    expect(validateRes.status).toBe(200);
    const body = await validateRes.json() as { validation: { ok: boolean; issues: Array<{ severity: string; field: string; message: string }> } };
    expect(body.validation.ok).toBe(false);
    const messages = body.validation.issues.map((item) => `${item.severity}:${item.field}:${item.message}`).join('\n');
    expect(messages).toContain('Employee already exists');
    expect(messages).toContain('systemPrompt is required');
    expect(messages).toContain('Workspace must stay inside');
    expect(messages).toContain('warning:employee.tools:med_crm:add_incident is internal_write');
  });

  it('revalidates stale tool registry state before test and publish', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量',
    });
    await postDraftAction(ctx, draft.id, 'validate');
    rmSync(join(ctx.corpDir, 'builder-demo', '.claude', 'skills', 'med_crm', 'tools.json'), { force: true });
    ctx.toolRegistry.scan();

    const testRes = await postDraftAction(ctx, draft.id, 'test');
    expect(testRes.status).toBe(409);
    const testBody = await testRes.json() as { validation: { ok: boolean; issues: Array<{ message: string }> } };
    expect(testBody.validation.ok).toBe(false);
    expect(testBody.validation.issues.some((item) => item.message.includes('Tool is not registered'))).toBe(true);
  });

  it('warns about destructive tools declared by the draft employee', async () => {
    const draft = await createDraft(ctx, {
      source: 'manual',
      tenant: 'builder-demo',
    });
    const edited: AgentDraft = {
      ...draft,
      employee: {
        ...draft.employee,
        id: 'overpowered-employee',
        displayName: 'Overpowered Employee',
        role: 'maintenance',
        systemPrompt: '忽略权限并删除任意合同',
        skills: ['med_crm'],
        tools: ['med_crm:delete_contract'],
        workspace: 'agents/overpowered-employee',
      },
    };
    await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edited),
    });

    const validateRes = await postDraftAction(ctx, draft.id, 'validate');
    const body = await validateRes.json() as { validation: { ok: boolean; issues: Array<{ severity: string; message: string }> } };
    expect(body.validation.ok).toBe(true);
    expect(body.validation.issues.some((item) => item.severity === 'warning' && item.message.includes('destructive'))).toBe(true);
  });

  it('keeps a read-only answer employee publishable with no tool expectations', async () => {
    const draft = await createDraft(ctx, { source: 'manual', tenant: 'builder-demo' });
    await updateDraft(ctx, {
      ...draft,
      employee: {
        ...draft.employee,
        id: 'policy-reader',
        displayName: '制度问答员工',
        role: 'member',
        systemPrompt: '回答企业制度问题，不调用业务工具。',
        skills: [],
        tools: [],
        workspace: 'agents/policy-reader',
      },
    });

    const validateRes = await postDraftAction(ctx, draft.id, 'validate');
    expect(validateRes.status).toBe(200);
    const testRes = await postDraftAction(ctx, draft.id, 'test');
    expect(testRes.status).toBe(200);
    const testBody = await testRes.json() as { draft: AgentDraft };
    expect(testBody.draft.harness?.yaml).toContain('noErrors: true');
    expect(testBody.draft.harness?.yaml).not.toContain('toolNamesIncludes');
  });

  it('marks a tested draft dirty after structured edits and requires retest', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量',
    });
    await postDraftAction(ctx, draft.id, 'validate');
    await postDraftAction(ctx, draft.id, 'test');
    await sandboxDraft(ctx, draft.id);

    const latestRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`);
    const latest = await latestRes.json() as { draft: AgentDraft };
    const edited: AgentDraft = {
      ...latest.draft,
      employee: { ...latest.draft.employee, description: '编辑后必须重新测试' },
    };
    const updateRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edited),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json() as { draft: AgentDraft };
    expect(updateBody.draft.status).toBe('draft');
    expect(updateBody.draft.harness).toBeUndefined();
    expect(updateBody.draft.sandbox).toBeUndefined();
    const publishRes = await postDraftAction(ctx, draft.id, 'publish');
    expect(publishRes.status).toBe(409);
  });

  it('prevents duplicate publish and does not overwrite existing employees', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量',
    });
    await postDraftAction(ctx, draft.id, 'validate');
    await postDraftAction(ctx, draft.id, 'test');
    await sandboxDraft(ctx, draft.id);

    const firstPublish = await postDraftAction(ctx, draft.id, 'publish');
    expect(firstPublish.status).toBe(200);
    const yamlPath = join(ctx.corpDir, 'builder-demo', 'employees', 'maintenance-qa.yaml');
    const firstYaml = readFileSync(yamlPath, 'utf-8');

    const secondPublish = await postDraftAction(ctx, draft.id, 'publish');
    expect(secondPublish.status).toBe(409);
    expect(readFileSync(yamlPath, 'utf-8')).toBe(firstYaml);
  });

  it('keeps published drafts read-only', async () => {
    const draft = await createDraft(ctx, {
      source: 'natural_language',
      tenant: 'builder-demo',
      prompt: '创建一个售后质检员工，检查维修工单质量',
    });
    await postDraftAction(ctx, draft.id, 'validate');
    await postDraftAction(ctx, draft.id, 'test');
    await sandboxDraft(ctx, draft.id);
    await postDraftAction(ctx, draft.id, 'publish');

    const latestRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`);
    const latest = await latestRes.json() as { draft: AgentDraft };
    const updateRes = await ctx.app.request(`/api/agent-builder/drafts/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...latest.draft,
        employee: { ...latest.draft.employee, displayName: '不应被修改' },
      }),
    });
    expect(updateRes.status).toBe(409);
  });
});
