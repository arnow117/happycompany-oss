import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { MessageIngressRuntime } from '../runtime.js';
import type { IngressMessageInput, IngressResult } from '../types.js';
import type { ConversationMode, RuntimeMessageInput, RuntimeProfile, RuntimeTarget } from '../../runtime-profile.js';

const simulatedSchema = z
  .object({
    routing: z
      .object({
        mode: z.string().optional(),
        selectedEmployee: z.string().optional(),
        boundEmployee: z.string().optional(),
        selectorShown: z.boolean().optional(),
      })
      .optional(),
    toolCalls: z
      .array(z.object({ name: z.string(), elapsedMs: z.number().int().nonnegative().default(1) }))
      .optional(),
    memory: z
      .array(
        z.object({
          operation: z.enum(['append', 'search', 'read', 'write']),
          subject: z.string(),
          workspace: z.string().optional(),
        }),
      )
      .optional(),
    handoffs: z
      .array(z.object({ from: z.string(), to: z.string(), reason: z.string().optional() }))
      .optional(),
    businessArtifacts: z
      .array(z.object({
        type: z.string(),
        id: z.string().optional(),
        status: z.enum(['created', 'updated', 'triggered']).default('created'),
      }))
      .optional(),
  })
  .optional();

const runtimeTargetSchema = z.object({
  employeeId: z.string().min(1).optional(),
  workflowThreadId: z.string().min(1).optional(),
  draftId: z.string().min(1).optional(),
});

const conversationModeSchema = z.enum(['single_employee', 'workflow_group', 'builder_sandbox']);

const runtimeInputSchema = z.object({
  tenant: z.string().min(1),
  entryId: z.string().min(1),
  actorId: z.string().min(1),
  target: runtimeTargetSchema.optional(),
  mode: conversationModeSchema.optional(),
  /**
   * Optional resolved fields for fake/offline harness runs. Real server routes
   * ignore these and resolve through RuntimeResolver.
   */
  resolved: z
    .object({
      channel: z.enum(['web', 'dingtalk', 'feishu', 'harness', 'builder_sandbox']).optional(),
      employeeId: z.string().min(1),
      instanceId: z.string().min(1),
      workdir: z.string().min(1),
      sdkSessionScope: z.string().min(1),
      userId: z.string().min(1).optional(),
    })
    .optional(),
});

const caseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  input: z.object({
    channel: z.enum(['web', 'dingtalk', 'feishu', 'harness', 'builder_sandbox']).default('harness'),
    botName: z.string().min(1),
    tenant: z.string().optional(),
    userId: z.string().optional(),
    chatId: z.string().min(1),
    messageId: z.string().optional(),
    handoffMode: z.enum(['auto', 'disabled']).optional(),
    text: z.string().default(''),
    runtime: runtimeInputSchema.optional(),
  }),
  /**
   * Optional simulation hints, honored only by --fake mode. They let a YAML
   * case declare what trace shape the real agent factory would produce, so
   * the fake harness can emit identical hook events without bootstrapping the
   * full server.
   */
  simulated: simulatedSchema,
  expect: z
    .object({
      replyContains: z.array(z.string()).optional(),
      replyEquals: z.string().optional(),
      toolNamesIncludes: z.array(z.string()).optional(),
      toolNamesExcludes: z.array(z.string()).optional(),
      memoryWorkspaceContains: z.string().optional(),
      memoryOperations: z
        .array(z.object({
          operation: z.enum(['append', 'search', 'read', 'write']).optional(),
          subject: z.string().optional(),
          subjectContains: z.string().optional(),
          workspaceContains: z.string().optional(),
        }))
        .optional(),
      handoffCount: z.number().int().min(0).optional(),
      handoffChain: z
        .array(z.object({
          from: z.string(),
          to: z.string(),
          reasonContains: z.string().optional(),
        }))
        .optional(),
      businessArtifactsCreated: z.array(z.string()).optional(),
      businessArtifactIdsInclude: z.array(z.string()).optional(),
      routedEmployee: z.string().optional(),
      selectorShown: z.boolean().optional(),
      noErrors: z.boolean().optional(),
      runtime: z
        .object({
          tenant: z.string().optional(),
          entryId: z.string().optional(),
          actorId: z.string().optional(),
          sessionId: z.string().optional(),
          employeeId: z.string().optional(),
          instanceId: z.string().optional(),
          workdirContains: z.string().optional(),
          sdkSessionScope: z.string().optional(),
          sdkSessionScopeContains: z.string().optional(),
          mode: conversationModeSchema.optional(),
        })
        .optional(),
    })
    .default({}),
});

export type HarnessCase = z.infer<typeof caseSchema>;
export type HarnessCaseExpect = HarnessCase['expect'];

export interface HarnessAssertionFailure {
  expectation: string;
  expected: unknown;
  actual: unknown;
}

export interface HarnessCaseResult {
  case: HarnessCase;
  status: 'passed' | 'failed' | 'error';
  failures: HarnessAssertionFailure[];
  ingress?: IngressResult;
  error?: string;
}

export interface HarnessRuntimeResolver {
  resolve(input: RuntimeMessageInput): RuntimeProfile;
}

export interface RunHarnessCaseOptions {
  runtimeResolver?: HarnessRuntimeResolver;
}

export function loadCaseFromYaml(yamlText: string, sourcePath?: string): HarnessCase {
  const raw = parseYaml(yamlText) as unknown;
  const parsed = caseSchema.safeParse(raw);
  if (!parsed.success) {
    const where = sourcePath ? ` (${sourcePath})` : '';
    throw new Error(`Invalid harness case${where}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function loadCaseFromFile(path: string): HarnessCase {
  return loadCaseFromYaml(readFileSync(path, 'utf-8'), path);
}

export async function runHarnessCase(
  runtime: MessageIngressRuntime,
  testCase: HarnessCase,
  options: RunHarnessCaseOptions = {},
): Promise<HarnessCaseResult> {
  try {
    const input = buildIngressInput(testCase, options);
    const ingress = await runtime.handle(input, {
      handoffMode: testCase.input.handoffMode,
    });
    const failures = assert(testCase, ingress);
    return {
      case: testCase,
      status: failures.length === 0 ? 'passed' : 'failed',
      failures,
      ingress,
    };
  } catch (err: unknown) {
    return {
      case: testCase,
      status: 'error',
      failures: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildIngressInput(testCase: HarnessCase, options: RunHarnessCaseOptions): IngressMessageInput {
  const runtimeInput = testCase.input.runtime;
  if (!runtimeInput) {
    return {
      channel: testCase.input.channel,
      botName: testCase.input.botName,
      tenant: testCase.input.tenant,
      userId: testCase.input.userId,
      chatId: testCase.input.chatId,
      messageId: testCase.input.messageId,
      text: testCase.input.text,
    };
  }

  const mode: ConversationMode = runtimeInput.mode ?? 'single_employee';
  if (options.runtimeResolver) {
    const profile = options.runtimeResolver.resolve({
      tenant: runtimeInput.tenant,
      entryId: runtimeInput.entryId,
      actorId: runtimeInput.actorId,
      chatId: testCase.input.chatId,
      text: testCase.input.text,
      target: runtimeInput.target,
    });
    return inputFromResolvedRuntime(testCase, runtimeInput, mode, {
      channel: profile.entry.channel,
      employeeId: profile.employee.id,
      instanceId: profile.instance.instanceId,
      workdir: profile.instance.workdir,
      sdkSessionScope: profile.instance.sdkSessionScope,
      userId: profile.actor.peopleUserId ?? profile.actor.actorId,
    });
  }

  if (runtimeInput.resolved) {
    return inputFromResolvedRuntime(testCase, runtimeInput, mode, {
      channel: runtimeInput.resolved.channel ?? testCase.input.channel,
      employeeId: runtimeInput.resolved.employeeId,
      instanceId: runtimeInput.resolved.instanceId,
      workdir: runtimeInput.resolved.workdir,
      sdkSessionScope: runtimeInput.resolved.sdkSessionScope,
      userId: runtimeInput.resolved.userId ?? testCase.input.userId,
    });
  }

  throw new Error(`Harness case ${testCase.id} uses input.runtime but no runtimeResolver or runtime.resolved fields were provided`);
}

function inputFromResolvedRuntime(
  testCase: HarnessCase,
  runtimeInput: { tenant: string; entryId: string; actorId: string; target?: RuntimeTarget },
  mode: ConversationMode,
  resolved: {
    channel: IngressMessageInput['channel'];
    employeeId: string;
    instanceId: string;
    workdir: string;
    sdkSessionScope: string;
    userId?: string;
  },
): IngressMessageInput {
  return {
    channel: resolved.channel,
    botName: resolved.employeeId,
    tenant: runtimeInput.tenant,
    entryId: runtimeInput.entryId,
    actorId: runtimeInput.actorId,
    userId: resolved.userId ?? testCase.input.userId ?? runtimeInput.actorId,
    chatId: testCase.input.chatId,
    messageId: testCase.input.messageId,
    sessionId: resolved.sdkSessionScope,
    employeeId: resolved.employeeId,
    instanceId: resolved.instanceId,
    workdir: resolved.workdir,
    sdkSessionScope: resolved.sdkSessionScope,
    mode,
    text: testCase.input.text,
  };
}

function assert(testCase: HarnessCase, result: IngressResult): HarnessAssertionFailure[] {
  return assertHarnessExpect(testCase.expect, result);
}

/**
 * Apply a harness expect block against any IngressResult. Exposed so the
 * Evaluator Gate (per plan §6 Phase 7) can reuse the same assertion engine
 * to evaluate a StepRun's IngressTrace without re-implementing the checks.
 */
export function assertHarnessExpect(
  exp: HarnessCaseExpect,
  result: IngressResult,
): HarnessAssertionFailure[] {
  const failures: HarnessAssertionFailure[] = [];
  const trace = result.trace;

  if (exp.replyEquals !== undefined && result.reply !== exp.replyEquals) {
    failures.push({
      expectation: 'replyEquals',
      expected: exp.replyEquals,
      actual: result.reply,
    });
  }

  if (exp.replyContains?.length) {
    for (const needle of exp.replyContains) {
      if (!result.reply.includes(needle)) {
        failures.push({
          expectation: `replyContains "${needle}"`,
          expected: needle,
          actual: result.reply,
        });
      }
    }
  }

  if (exp.toolNamesIncludes?.length) {
    const seen = new Set(trace.toolCalls.map((t) => t.name));
    for (const need of exp.toolNamesIncludes) {
      if (!seen.has(need)) {
        failures.push({
          expectation: `toolNames includes "${need}"`,
          expected: need,
          actual: [...seen],
        });
      }
    }
  }

  if (exp.toolNamesExcludes?.length) {
    const seen = new Set(trace.toolCalls.map((t) => t.name));
    for (const forbid of exp.toolNamesExcludes) {
      if (seen.has(forbid)) {
        failures.push({
          expectation: `toolNames excludes "${forbid}"`,
          expected: `absence of "${forbid}"`,
          actual: [...seen],
        });
      }
    }
  }

  if (exp.memoryWorkspaceContains) {
    const matched = trace.memory.some((m) => m.workspace?.includes(exp.memoryWorkspaceContains!));
    if (!matched) {
      failures.push({
        expectation: `memory workspace contains "${exp.memoryWorkspaceContains}"`,
        expected: exp.memoryWorkspaceContains,
        actual: trace.memory.map((m) => m.workspace ?? null),
      });
    }
  }

  if (exp.memoryOperations?.length) {
    for (const expected of exp.memoryOperations) {
      const matched = trace.memory.some((actual) => {
        if (expected.operation !== undefined && actual.operation !== expected.operation) return false;
        if (expected.subject !== undefined && actual.subject !== expected.subject) return false;
        if (expected.subjectContains !== undefined && !actual.subject.includes(expected.subjectContains)) return false;
        if (expected.workspaceContains !== undefined && !actual.workspace?.includes(expected.workspaceContains)) return false;
        return true;
      });
      if (!matched) {
        failures.push({
          expectation: 'memory operation exists',
          expected,
          actual: trace.memory,
        });
      }
    }
  }

  if (exp.handoffCount !== undefined && trace.handoffs.length !== exp.handoffCount) {
    failures.push({
      expectation: `handoffCount === ${exp.handoffCount}`,
      expected: exp.handoffCount,
      actual: trace.handoffs.length,
    });
  }

  if (exp.handoffChain?.length) {
    const actualChain = trace.handoffs.map((handoff) => ({
      from: handoff.from,
      to: handoff.to,
      reason: handoff.reason,
    }));
    exp.handoffChain.forEach((expected, index) => {
      const actual = trace.handoffs[index];
      const matches = actual
        && actual.from === expected.from
        && actual.to === expected.to
        && (expected.reasonContains === undefined || actual.reason?.includes(expected.reasonContains));
      if (!matches) {
        failures.push({
          expectation: `handoffChain[${index}] matches`,
          expected,
          actual: actualChain,
        });
      }
    });
  }

  if (exp.businessArtifactsCreated?.length) {
    const created = new Set(
      trace.businessArtifacts
        .filter((artifact) => artifact.status === 'created')
        .map((artifact) => artifact.type),
    );
    for (const expectedType of exp.businessArtifactsCreated) {
      if (!created.has(expectedType)) {
        failures.push({
          expectation: `businessArtifacts created "${expectedType}"`,
          expected: expectedType,
          actual: trace.businessArtifacts,
        });
      }
    }
  }

  if (exp.businessArtifactIdsInclude?.length) {
    const ids = new Set(trace.businessArtifacts.map((artifact) => artifact.id).filter((id): id is string => !!id));
    for (const expectedId of exp.businessArtifactIdsInclude) {
      if (!ids.has(expectedId)) {
        failures.push({
          expectation: `businessArtifact id "${expectedId}"`,
          expected: expectedId,
          actual: [...ids],
        });
      }
    }
  }

  if (exp.routedEmployee !== undefined && trace.routing.selectedEmployee !== exp.routedEmployee) {
    failures.push({
      expectation: `routing.selectedEmployee === "${exp.routedEmployee}"`,
      expected: exp.routedEmployee,
      actual: trace.routing.selectedEmployee ?? null,
    });
  }

  if (exp.selectorShown !== undefined && trace.routing.selectorShown !== exp.selectorShown) {
    failures.push({
      expectation: `routing.selectorShown === ${exp.selectorShown}`,
      expected: exp.selectorShown,
      actual: trace.routing.selectorShown ?? null,
    });
  }

  if (exp.noErrors && trace.errors.length > 0) {
    failures.push({
      expectation: 'no errors recorded',
      expected: [],
      actual: trace.errors,
    });
  }

  if (exp.runtime) {
    const actual = trace.runtime;
    const expected = exp.runtime;
    const checks: Array<[string, unknown, unknown]> = [
      ['runtime.tenant', expected.tenant, actual?.tenant],
      ['runtime.entryId', expected.entryId, actual?.entryId],
      ['runtime.actorId', expected.actorId, actual?.actorId],
      ['runtime.sessionId', expected.sessionId, actual?.sessionId],
      ['runtime.employeeId', expected.employeeId, actual?.employeeId],
      ['runtime.instanceId', expected.instanceId, actual?.instanceId],
      ['runtime.sdkSessionScope', expected.sdkSessionScope, actual?.sdkSessionScope],
      ['runtime.mode', expected.mode, actual?.mode],
    ];
    for (const [label, expectedValue, actualValue] of checks) {
      if (expectedValue !== undefined && actualValue !== expectedValue) {
        failures.push({
          expectation: `${label} === "${expectedValue}"`,
          expected: expectedValue,
          actual: actualValue ?? null,
        });
      }
    }
    if (expected.workdirContains && !actual?.workdir?.includes(expected.workdirContains)) {
      failures.push({
        expectation: `runtime.workdir contains "${expected.workdirContains}"`,
        expected: expected.workdirContains,
        actual: actual?.workdir ?? null,
      });
    }
    if (expected.sdkSessionScopeContains && !actual?.sdkSessionScope?.includes(expected.sdkSessionScopeContains)) {
      failures.push({
        expectation: `runtime.sdkSessionScope contains "${expected.sdkSessionScopeContains}"`,
        expected: expected.sdkSessionScopeContains,
        actual: actual?.sdkSessionScope ?? null,
      });
    }
  }

  return failures;
}

export function formatResult(result: HarnessCaseResult): string {
  const symbol = result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '!';
  const head = `${symbol} ${result.case.id} — ${result.status}`;
  if (result.status === 'passed') return head;
  if (result.status === 'error') return `${head}\n   error: ${result.error}`;
  const lines = result.failures.map(
    (f) => `   - ${f.expectation}\n       expected: ${JSON.stringify(f.expected)}\n       actual:   ${JSON.stringify(f.actual)}`,
  );
  return `${head}\n${lines.join('\n')}`;
}
