import type { Hono } from 'hono';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { AgentFactory } from '../bot.js';
import type { MessageBus } from '../bus.js';
import type { MessageStore } from '../store.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { EmployeeManager } from '../orchestrator/employee-colony.js';
import type { EmployeeDefinition } from '../orchestrator/employee-schema.js';
import { employeeDefinitionSchema } from '../orchestrator/employee-schema.js';
import { createAgentDraftBodySchema, agentDraftSchema, getDraftRuntimeFingerprint, touchDraft, type AgentDraft } from '../agent-builder/schema.js';
import { AgentDraftStore } from '../agent-builder/draft-store.js';
import { AgentDraftFactory, type NaturalLanguageDraftGenerator } from '../agent-builder/draft-factory.js';
import { AgentDraftValidator } from '../agent-builder/validator.js';
import { buildHarnessYamlForDraft } from '../agent-builder/harness-builder.js';
import { AgentDraftPublisher } from '../agent-builder/publisher.js';
import { CapabilityRegistry } from '../capability-registry.js';
import { assertHarnessExpect, loadCaseFromYaml } from '../ingress/adapters/harness.js';
import { MessageIngressRuntime } from '../ingress/runtime.js';
import type { IngressResult } from '../ingress/types.js';
import { writeEmployeeClaudeMd } from '../orchestrator/employee-prompt.js';
import { scanSkillDirectory } from '../skills.js';

export interface AgentBuilderRoutesDeps {
  dataDir: string;
  corpDir: string;
  toolRegistry: ToolRegistry;
  employeeManager?: EmployeeManager;
  generator?: NaturalLanguageDraftGenerator;
  agentFactory?: AgentFactory;
  store?: MessageStore;
  bus?: MessageBus;
}

const sandboxMessageBodySchema = z.object({
  actorId: z.string().min(1).default('builder-admin'),
  chatId: z.string().min(1).optional(),
  text: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

function listEmployeeFiles(corpDir: string, tenant: string): EmployeeDefinition[] {
  const result: EmployeeDefinition[] = [];
  const dir = join(corpDir, tenant, 'employees');
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const parsed = parseYaml(readFileSync(join(dir, file), 'utf-8')) as unknown;
      result.push(employeeDefinitionSchema.parse(parsed));
    } catch {
      // Ignore invalid employee files here; loader tests cover parse failures.
    }
  }
  return result;
}

function findEmployee(corpDir: string, manager: EmployeeManager | undefined, tenant: string, employeeId: string): EmployeeDefinition | null {
  const managed = manager?.get(employeeId, tenant)?.app;
  if (managed) return managed;
  return listEmployeeFiles(corpDir, tenant).find((employee) => employee.id === employeeId) ?? null;
}

function employeeExists(corpDir: string, manager: EmployeeManager | undefined, tenant: string, employeeId: string): boolean {
  return Boolean(findEmployee(corpDir, manager, tenant, employeeId));
}

function fakeIngressFromDraft(draft: AgentDraft): IngressResult {
  const now = Date.now();
  const firstTool = draft.employee.tools[0];
  return {
    reply: `${draft.employee.displayName} 已收到并处理请求。`,
    trace: {
      input: {
        channel: 'harness',
        botName: draft.employee.id,
        tenant: draft.tenant,
        userId: `employee:${draft.employee.id}`,
        chatId: `harness-agent-builder-${draft.employee.id}`,
      },
      routing: { selectedEmployee: draft.employee.id },
      toolCalls: firstTool
        ? [{ name: firstTool, status: 'complete', elapsedMs: 10, startedAt: now, finishedAt: now + 10 }]
        : [],
      memory: [],
      handoffs: [],
      businessArtifacts: [],
      errors: [],
      startedAt: now,
      finishedAt: now + 10,
    },
  };
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function registerAgentBuilderRoutes(app: Hono, deps: AgentBuilderRoutesDeps): void {
  const store = new AgentDraftStore(deps.dataDir);
  const factory = new AgentDraftFactory({
    corpDir: deps.corpDir,
    generator: deps.generator,
    findEmployee: (tenant, employeeId) => findEmployee(deps.corpDir, deps.employeeManager, tenant, employeeId),
    listEmployees: (tenant) => listEmployeeFiles(deps.corpDir, tenant),
  });
  const validator = new AgentDraftValidator({
    corpDir: deps.corpDir,
    toolRegistry: deps.toolRegistry,
    employeeExists: (tenant, employeeId) => employeeExists(deps.corpDir, deps.employeeManager, tenant, employeeId),
  });
  const publisher = new AgentDraftPublisher({
    corpDir: deps.corpDir,
    employeeManager: deps.employeeManager,
  });
  const sandboxRuntime = deps.agentFactory && deps.store && deps.bus
    ? new MessageIngressRuntime({
        agentFactory: deps.agentFactory,
        store: deps.store,
        bus: deps.bus,
      })
    : null;
  const publishingEmployees = new Set<string>();

  function capabilityRegistry(tenant: string): CapabilityRegistry {
    const employees = listEmployeeFiles(deps.corpDir, tenant).map((employee) => ({
      ...employee,
      tenantName: tenant,
      filePath: '',
      loadedAtMs: 0,
    }));
    return new CapabilityRegistry({
      corpDir: deps.corpDir,
      toolRegistry: deps.toolRegistry,
      employees,
    });
  }

  app.get('/api/agent-builder/options', (c) => {
    const tenant = c.req.query('tenant');
    if (!tenant) return c.json({ error: 'tenant is required' }, 400);
    const tools = deps.toolRegistry.getToolsForTenant(tenant).map((tool) => ({
      name: tool.namespacedName,
      skillName: tool.skillName,
      appName: tool.appName,
      description: tool.description,
      riskLevel: tool.riskLevel,
    }));
    const skillsByName = new Map<string, { name: string; displayName: string; description: string; toolCount: number }>();
    for (const skill of deps.toolRegistry.getSkillSummaries(tenant)) {
      skillsByName.set(skill.name, {
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        toolCount: skill.toolCount,
      });
    }
    for (const skill of scanSkillDirectory(join(deps.corpDir, tenant, '.claude', 'skills'), 'tenant')) {
      if (skillsByName.has(skill.id)) continue;
      skillsByName.set(skill.id, {
        name: skill.id,
        displayName: skill.name,
        description: skill.description,
        toolCount: skill.allowedTools.length,
      });
    }
    const skills = Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
    const employees = listEmployeeFiles(deps.corpDir, tenant).map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
      role: employee.role,
      workspace: employee.workspace,
    }));
    return c.json({ tenant, skills, tools, employees });
  });

  app.get('/api/agent-builder/drafts', (c) => c.json({ drafts: store.list() }));

  app.post('/api/agent-builder/drafts', async (c) => {
    try {
      const raw = await c.req.json() as unknown;
      const parsed = createAgentDraftBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }
      const draft = await factory.create(parsed.data);
      return c.json({ draft: store.save(draft) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found') || message.includes('not exist') ? 404 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get('/api/agent-builder/drafts/:id', (c) => {
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    return c.json({ draft });
  });

  app.get('/api/agent-builder/drafts/:id/capabilities', (c) => {
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    return c.json({ capability: capabilityRegistry(draft.tenant).preview(draft.tenant, draft.employee) });
  });

  app.put('/api/agent-builder/drafts/:id', async (c) => {
    const current = store.get(c.req.param('id'));
    if (!current) return c.json({ error: 'Draft not found' }, 404);
    try {
      const raw = await c.req.json() as unknown;
      const candidate = (
        raw && typeof raw === 'object' && 'draft' in raw
          ? (raw as { draft?: unknown }).draft
          : raw
      );
      const parsed = agentDraftSchema.safeParse({
        ...(typeof candidate === 'object' && candidate !== null ? candidate : {}),
        id: current.id,
        tenant: current.tenant,
        source: current.source,
        createdAt: current.createdAt,
        status: current.status === 'published' ? 'published' : 'draft',
        validation: { ok: false, issues: [] },
        harness: undefined,
        sandbox: undefined,
      });
      if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
      if (current.status === 'published') return c.json({ error: 'Published draft is read-only' }, 409);
      return c.json({ draft: store.save(parsed.data) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/agent-builder/drafts/:id/validate', (c) => {
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    const validation = validator.validate(draft);
    const next = touchDraft(draft, {
      status: validation.ok ? 'validated' : 'draft',
      validation,
      harness: undefined,
    });
    return c.json({ draft: store.save(next), validation });
  });

  app.post('/api/agent-builder/drafts/:id/test', (c) => {
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    const validation = validator.validate(draft);
    if (!validation.ok) {
      const next = store.save(touchDraft(draft, { status: 'draft', validation, harness: undefined }));
      return c.json({ error: 'Draft has validation errors', draft: next, validation }, 409);
    }
    const yaml = buildHarnessYamlForDraft(draft);
    const testCase = loadCaseFromYaml(yaml, `${draft.id}.yaml`);
    const failures = assertHarnessExpect(testCase.expect, fakeIngressFromDraft(draft));
    const passed = failures.length === 0;
    const next = touchDraft(draft, {
      status: passed ? 'tested' : 'validated',
      validation,
      harness: {
        yaml,
        lastResult: passed ? 'passed' : 'failed',
        failures: failures.map((failure) => failure.expectation),
      },
    });
    return c.json({ draft: store.save(next), result: { status: passed ? 'passed' : 'failed', failures } }, passed ? 200 : 409);
  });

  app.post('/api/agent-builder/drafts/:id/sandbox/messages', async (c) => {
    if (!sandboxRuntime || !deps.store) {
      return c.json({ error: 'Builder sandbox runtime is not configured' }, 501);
    }
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    const validation = validator.validate(draft);
    if (!validation.ok) {
      const next = store.save(touchDraft(draft, { status: 'draft', validation, harness: undefined }));
      return c.json({ error: 'Draft has validation errors', draft: next, validation }, 409);
    }

    try {
      const parsed = sandboxMessageBodySchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

      const { actorId, text, timeoutMs } = parsed.data;
      const chatId = parsed.data.chatId ?? `builder-sandbox-${draft.id}`;
      const safeTenant = safePathSegment(draft.tenant);
      const safeDraftId = safePathSegment(draft.id);
      const safeActorId = safePathSegment(actorId);
      const workdir = resolve(deps.dataDir, 'agent-builder', 'sandbox', safeTenant, safeDraftId, safeActorId);
      mkdirSync(workdir, { recursive: true });
      writeEmployeeClaudeMd(workdir, draft.employee);

      const entryId = `builder-sandbox:${draft.id}`;
      const instanceId = `${draft.tenant}:${actorId}:draft:${draft.id}`;
      const sessionId = `${draft.tenant}:builder_sandbox:${draft.id}:${actorId}:${chatId}`;
      const sdkSessionScope = sessionId;
      const result = await sandboxRuntime.handle({
        channel: 'builder_sandbox',
        botName: draft.employee.id,
        tenant: draft.tenant,
        entryId,
        actorId,
        userId: actorId,
        chatId,
        sessionId,
        employeeId: draft.employee.id,
        instanceId,
        workdir,
        sdkSessionScope,
        mode: 'builder_sandbox',
        text,
      }, {
        timeoutMs,
        runtimeAgentDir: workdir,
        runtimeCwd: workdir,
      });
      const session = deps.store.getRuntimeSession(sessionId);
      const next = store.save(touchDraft(draft, {
        validation,
        sandbox: {
          lastSessionId: sessionId,
          lastResult: 'passed',
          reply: result.reply,
          testedAt: Date.now(),
          fingerprint: getDraftRuntimeFingerprint(draft),
        },
      }));

      return c.json({
        draft: next,
        session,
        reply: result.reply,
        trace: result.trace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post('/api/agent-builder/drafts/:id/publish', (c) => {
    const draft = store.get(c.req.param('id'));
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    const validation = validator.validate(draft);
    const sandboxPassed = draft.sandbox?.lastResult === 'passed'
      && draft.sandbox.fingerprint === getDraftRuntimeFingerprint(draft);
    if (!validation.ok || draft.status !== 'tested' || draft.harness?.lastResult !== 'passed' || !sandboxPassed) {
      const next = store.save(touchDraft(draft, {
        status: validation.ok ? draft.status : 'draft',
        validation,
        sandbox: validation.ok ? draft.sandbox : undefined,
      }));
      return c.json({
        error: 'Draft must be validated, harness tested, and sandboxed before publish',
        draft: next,
        validation,
      }, 409);
    }
    const publishKey = `${draft.tenant}:${draft.employee.id}`;
    if (publishingEmployees.has(publishKey)) {
      return c.json({ error: `Employee publish already in progress: ${draft.employee.id}` }, 409);
    }
    publishingEmployees.add(publishKey);
    try {
      const published = publisher.publish(draft);
      const next = store.save(touchDraft(draft, { status: 'published', validation }));
      return c.json({ draft: next, ...published });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, message.includes('already exists') ? 409 : 500);
    } finally {
      publishingEmployees.delete(publishKey);
    }
  });
}
