import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Hono } from 'hono';
import type { AgentFactory } from '../bot.js';
import type { MessageBus } from '../bus.js';
import type { Config } from '../config.js';
import { MessageIngressRuntime } from '../ingress/runtime.js';
import {
  type HarnessCase,
  type HarnessCaseResult,
  formatResult,
  loadCaseFromYaml,
  runHarnessCase,
} from '../ingress/adapters/harness.js';
import type { MessageStore } from '../store.js';
import type { StepRunInput } from '../harness/step-run.js';
import { StepRunner } from '../harness/step-runner.js';
import { StepRunStore } from '../harness/step-run-store.js';
import { RuntimeResolver, type RuntimeEmployeeDirectory } from '../runtime-resolver.js';

export interface HarnessRoutesDeps {
  agentFactory: AgentFactory;
  store: MessageStore;
  bus: MessageBus;
  fixtureDir?: string;
  stepRunStore?: StepRunStore;
  corpDir?: string;
  configRef?: { current: Pick<Config, 'bots'> };
  employeeManager?: RuntimeEmployeeDirectory;
}

interface HarnessRunBody {
  yaml: string;
  sourcePath?: string;
}

interface HarnessCaseSummary {
  id: string;
  description?: string;
  file: string;
  input: {
    channel: string;
    botName: string;
    tenant?: string;
    userId?: string;
    handoffMode?: 'auto' | 'disabled';
    runtime?: {
      tenant: string;
      entryId: string;
      actorId: string;
      targetEmployeeId?: string;
      mode?: string;
    };
  };
  expect: {
    routedEmployee?: string;
    selectorShown?: boolean;
    handoffCount?: number;
    toolNamesIncludes?: string[];
    toolNamesExcludes?: string[];
    memoryWorkspaceContains?: string;
    noErrors?: boolean;
    runtime?: HarnessCase['expect']['runtime'];
  };
}

interface HarnessStepRunBody {
  workflowRunId?: string;
  stepId?: string;
  employeeId?: string;
  tenant?: string;
  userId?: string;
  chatId?: string;
  prompt: string;
  expectedArtifacts?: string[];
  runtime?: {
    tenant?: string;
    entryId?: string;
    actorId?: string;
    target?: {
      employeeId?: string;
      workflowThreadId?: string;
      draftId?: string;
    };
    mode?: 'single_employee' | 'workflow_group' | 'builder_sandbox';
  };
}

interface HarnessSuiteReport {
  id: string;
  createdAt: string;
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  results: HarnessCaseResult[];
  text: string;
}

let lastReport: HarnessSuiteReport | null = null;

function parseHarnessRunBody(raw: unknown): HarnessRunBody {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON body is required');
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.yaml !== 'string' || body.yaml.trim().length === 0) {
    throw new Error('yaml must be a non-empty string');
  }
  const sourcePath = typeof body.sourcePath === 'string' ? body.sourcePath : undefined;
  return { yaml: body.yaml, sourcePath };
}

function parseOptionalCaseIds(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.caseIds)) return undefined;
  return body.caseIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function parseOptionalTenant(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) {
    throw new Error('tenant must be lowercase alphanumeric (a-z, 0-9, -)');
  }
  return raw;
}

function parseStepRunBody(raw: unknown): StepRunInput {
  if (!raw || typeof raw !== 'object') throw new Error('JSON body is required');
  const body = raw as HarnessStepRunBody;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    throw new Error('prompt is required');
  }
  const employeeId = typeof body.employeeId === 'string' && body.employeeId.trim()
    ? body.employeeId.trim()
    : undefined;
  const runtime = parseStepRuntime(body.runtime, employeeId);
  if (!employeeId && !runtime) {
    throw new Error('employeeId or runtime target is required');
  }
  const expectedArtifacts = Array.isArray(body.expectedArtifacts)
    ? body.expectedArtifacts.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
  const workflowRunId = typeof body.workflowRunId === 'string' && body.workflowRunId.trim()
    ? body.workflowRunId.trim()
    : `workflow-${Date.now()}`;
  const stepId = typeof body.stepId === 'string' && body.stepId.trim()
    ? body.stepId.trim()
    : 'step-1';
  const chatId = typeof body.chatId === 'string' && body.chatId.trim()
    ? body.chatId.trim()
    : `harness-step-${workflowRunId}-${stepId}`;
  return {
    workflowRunId,
    stepId,
    employeeId,
    tenant: typeof body.tenant === 'string' ? body.tenant : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
    runtime,
    chatId,
    prompt: body.prompt.trim(),
    expectedArtifacts,
  };
}

function parseStepRuntime(raw: HarnessStepRunBody['runtime'], employeeId?: string): StepRunInput['runtime'] {
  if (!raw) return undefined;
  if (!raw.tenant || !raw.entryId || !raw.actorId) {
    throw new Error('runtime.tenant, runtime.entryId, and runtime.actorId are required');
  }
  const target = raw.target ?? (employeeId ? { employeeId } : undefined);
  return {
    tenant: raw.tenant,
    entryId: raw.entryId,
    actorId: raw.actorId,
    target,
    mode: raw.mode,
  };
}

function buildRuntimeResolver(deps: HarnessRoutesDeps): RuntimeResolver | undefined {
  if (!deps.corpDir || !deps.configRef || !deps.employeeManager) return undefined;
  return new RuntimeResolver({
    corpDir: deps.corpDir,
    config: deps.configRef.current,
    employeeManager: deps.employeeManager,
  });
}

function harnessFixtureDir(raw?: string): string {
  return resolve(raw ?? process.env.HAPPYCOMPANY_HARNESS_FIXTURE_DIR ?? 'tests/fixtures/harness');
}

function caseFiles(fixtureDir: string): string[] {
  if (!existsSync(fixtureDir)) return [];
  return readdirSync(fixtureDir)
    .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
    .map((entry) => join(fixtureDir, entry))
    .filter((file) => statSync(file).isFile())
    .sort();
}

function caseIdFromFile(file: string): string {
  return loadCaseFromYaml(readFileSync(file, 'utf-8'), file).id;
}

function summarizeCase(file: string): HarnessCaseSummary {
  const testCase = loadCaseFromYaml(readFileSync(file, 'utf-8'), file);
  return {
    id: testCase.id,
    description: testCase.description,
    file,
    input: {
      channel: testCase.input.channel,
      botName: testCase.input.botName,
      tenant: testCase.input.tenant,
      userId: testCase.input.userId,
      handoffMode: testCase.input.handoffMode,
      runtime: testCase.input.runtime
        ? {
            tenant: testCase.input.runtime.tenant,
            entryId: testCase.input.runtime.entryId,
            actorId: testCase.input.runtime.actorId,
            targetEmployeeId: testCase.input.runtime.target?.employeeId,
            mode: testCase.input.runtime.mode,
          }
        : undefined,
    },
    expect: {
      routedEmployee: testCase.expect.routedEmployee,
      selectorShown: testCase.expect.selectorShown,
      handoffCount: testCase.expect.handoffCount,
      toolNamesIncludes: testCase.expect.toolNamesIncludes,
      toolNamesExcludes: testCase.expect.toolNamesExcludes,
      memoryWorkspaceContains: testCase.expect.memoryWorkspaceContains,
      noErrors: testCase.expect.noErrors,
      runtime: testCase.expect.runtime,
    },
  };
}

function loadCases(fixtureDir: string, ids?: string[]): HarnessCase[] {
  const files = caseFiles(fixtureDir);
  const selected = ids && ids.length > 0
    ? files.filter((file) => ids.includes(caseIdFromFile(file)))
    : files;
  return selected.map((file) => loadCaseFromYaml(readFileSync(file, 'utf-8'), file));
}

function buildReport(results: HarnessCaseResult[]): HarnessSuiteReport {
  const failed = results.filter((result) => result.status !== 'passed').length;
  const passed = results.length - failed;
  return {
    id: `harness-${Date.now()}`,
    createdAt: new Date().toISOString(),
    summary: { passed, failed, total: results.length },
    results,
    text: `${results.map(formatResult).join('\n')}\n\n${passed} passed, ${failed} failed (${results.length} total)`,
  };
}

export function registerHarnessRoutes(app: Hono, deps: HarnessRoutesDeps): void {
  const fixtureDir = harnessFixtureDir(deps.fixtureDir);
  const runtime = new MessageIngressRuntime({
    agentFactory: deps.agentFactory,
    store: deps.store,
    bus: deps.bus,
  });
  const runtimeResolver = (): RuntimeResolver | undefined => buildRuntimeResolver(deps);
  const stepRuntimeResolver = deps.corpDir && deps.configRef && deps.employeeManager
    ? {
        resolve(input: Parameters<RuntimeResolver['resolve']>[0]) {
          const resolver = runtimeResolver();
          if (!resolver) throw new Error('RuntimeResolver is not configured for StepRunner');
          return resolver.resolve(input);
        },
      }
    : undefined;
  const stepRunner = new StepRunner({
    runtime,
    runtimeResolver: stepRuntimeResolver,
    store: deps.stepRunStore ?? new StepRunStore(),
  });

  app.post('/api/admin/harness/run', async (c) => {
    try {
      const body = parseHarnessRunBody(await c.req.json());
      const testCase = loadCaseFromYaml(body.yaml, body.sourcePath);
      const result = await runHarnessCase(runtime, testCase, {
        runtimeResolver: runtimeResolver(),
      });
      return c.json({ result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/admin/harness/cases', (c) => {
    try {
      const tenant = parseOptionalTenant(c.req.query('tenant'));
      const cases = caseFiles(fixtureDir)
        .map(summarizeCase)
        .filter((testCase) => !tenant || testCase.input.tenant === tenant);
      return c.json({
        fixtureDir,
        cases,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/admin/harness/run-suite', async (c) => {
    try {
      const caseIds = parseOptionalCaseIds(await c.req.json().catch(() => ({})));
      const testCases = loadCases(fixtureDir, caseIds);
      const results: HarnessCaseResult[] = [];
      for (const testCase of testCases) {
        results.push(await runHarnessCase(runtime, testCase, {
          runtimeResolver: runtimeResolver(),
        }));
      }
      lastReport = buildReport(results);
      return c.json({ report: lastReport });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/admin/harness/run-step', async (c) => {
    try {
      const input = parseStepRunBody(await c.req.json());
      const run = await stepRunner.dispatch(input);
      return c.json({ run });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/admin/harness/step-runs', (c) => {
    const workflowRunId = c.req.query('workflowRunId');
    const runs = workflowRunId
      ? stepRunner.store.listByWorkflow(workflowRunId)
      : stepRunner.store.list();
    return c.json({ runs });
  });

  app.get('/api/admin/harness/reports/latest', (c) => {
    if (!lastReport) return c.json({ report: null });
    return c.json({ report: lastReport });
  });
}
