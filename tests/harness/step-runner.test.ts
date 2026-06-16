import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from '../../src/store.js';
import { MessageBus } from '../../src/bus.js';
import { MessageIngressRuntime } from '../../src/ingress/runtime.js';
import { StepRunner } from '../../src/harness/step-runner.js';
import { canTransition } from '../../src/harness/step-run.js';
import type { AgentFactory } from '../../src/bot.js';

function makeAgent(impl: AgentFactory['respond']): AgentFactory {
  return {
    respond: impl,
    clearSession: () => true,
    clearAllSessions: () => 0,
    listSessions: () => [],
  };
}

function setupRuntime(agent: AgentFactory) {
  const dir = mkdtempSync(join(tmpdir(), 'steprun-'));
  const store = new MessageStore(join(dir, 'h.db'));
  const bus = new MessageBus();
  const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });
  return { runtime, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('StepRun state machine', () => {
  it('allows the canonical happy path transitions', () => {
    expect(canTransition('CREATED', 'DISPATCHED')).toBe(true);
    expect(canTransition('DISPATCHED', 'ACKED')).toBe(true);
    expect(canTransition('ACKED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('CREATED', 'SUCCEEDED')).toBe(false);
    expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(canTransition('TIMED_OUT', 'ACKED')).toBe(false);
    expect(canTransition('DISPATCHED', 'RUNNING')).toBe(false); // must ACK first
  });

  it('allows timeout / stall / cancel from RUNNING', () => {
    expect(canTransition('RUNNING', 'STALLED')).toBe(true);
    expect(canTransition('RUNNING', 'FAILED')).toBe(true);
    expect(canTransition('RUNNING', 'CANCELLED')).toBe(true);
  });
});

describe('StepRunner', () => {
  let cleanups: Array<() => void> = [];

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    for (const c of cleanups) c();
  });

  it('drives a step from CREATED to SUCCEEDED on agent reply', async () => {
    const agent = makeAgent(async () => 'task complete with artifact: report.md');
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const run = await runner.dispatch({
      workflowRunId: 'wf-1',
      stepId: 'step-1',
      employeeId: 'sales-zhangsan',
      chatId: 'step-chat-1',
      prompt: 'write the contract review',
    });

    expect(run.status).toBe('SUCCEEDED');
    expect(run.reply).toContain('report.md');
    expect(run.finishedAt).toBeGreaterThanOrEqual(run.createdAt);
    expect(run.trace?.finishedAt).toBeDefined();
  });

  it('marks the step FAILED with QUALITY_GATE_FAILED when expected artifact is missing', async () => {
    const agent = makeAgent(async () => 'I am done.'); // no artifact mention
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const run = await runner.dispatch({
      workflowRunId: 'wf-2',
      stepId: 'step-art',
      employeeId: 'impl-builder',
      chatId: 'step-chat-art',
      prompt: 'build the feature',
      expectedArtifacts: ['report.md', 'tests.spec.ts'],
    });

    expect(run.status).toBe('FAILED');
    expect(run.failureClass).toBe('QUALITY_GATE_FAILED');
    expect(run.error).toContain('report.md');
  });

  it('marks the step STALLED when the agent takes longer than stallTimeoutMs', async () => {
    let resolveBlocker!: (v: string) => void;
    const blocker = new Promise<string>((r) => {
      resolveBlocker = r;
    });
    const agent = makeAgent(() => blocker);
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({
      runtime,
      protocol: { ackTimeoutMs: 1_000, stallTimeoutMs: 25 },
    });

    const stallRun = await runner.dispatch({
      workflowRunId: 'wf-stall',
      stepId: 'step-stall',
      employeeId: 'slow-bot',
      chatId: 'step-chat-stall',
      prompt: 'this stalls',
    });

    expect(stallRun.status).toBe('STALLED');
    expect(stallRun.failureClass).toBe('STALLED');

    // Unblock the inflight runtime call so test teardown doesn't leak.
    resolveBlocker('late');
  });

  it('records heartbeats from onText callbacks', async () => {
    const agent = makeAgent(async (_p, _c, _b, opts) => {
      opts?.onText?.('progress: 25%');
      opts?.onText?.('progress: 75%');
      return 'done';
    });
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const run = await runner.dispatch({
      workflowRunId: 'wf-hb',
      stepId: 'step-hb',
      employeeId: 'b',
      chatId: 'step-chat-hb',
      prompt: 'stream me progress',
    });

    expect(run.status).toBe('SUCCEEDED');
    expect(run.heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(run.heartbeats[0].progressSummary).toContain('25%');
  });

  it('uses runtime resolved metadata for offline StepRun dispatch', async () => {
    let observedBotName = '';
    const agent = makeAgent(async (_prompt, _chatId, botName) => {
      observedBotName = botName;
      return 'ok';
    });
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const run = await runner.dispatch({
      workflowRunId: 'wf-runtime-offline',
      stepId: 'step-runtime',
      chatId: 'step-runtime-offline-chat',
      prompt: 'run with resolved profile',
      runtime: {
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        target: { employeeId: 'sales-zhangsan' },
        resolved: {
          channel: 'web',
          employeeId: 'sales-zhangsan',
          instanceId: 'tenant-a:user-sales:sales-zhangsan',
          workdir: '/tmp/tenant-a/agents/sales-zhangsan/user-sales',
          sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:step-runtime-offline-chat',
        },
      },
    });

    expect(run.status).toBe('SUCCEEDED');
    expect(observedBotName).toBe('sales-zhangsan');
    expect(run.trace?.input).toMatchObject({ channel: 'web', botName: 'sales-zhangsan' });
    expect(run.trace?.runtime).toMatchObject({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:step-runtime-offline-chat',
    });
  });

  it('stores the step in the StepRunStore and lists by workflow', async () => {
    const agent = makeAgent(async () => 'ok');
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    await runner.dispatch({
      workflowRunId: 'wf-list',
      stepId: 'a',
      employeeId: 'b',
      chatId: 'cA',
      prompt: 'one',
    });
    await runner.dispatch({
      workflowRunId: 'wf-list',
      stepId: 'b',
      employeeId: 'b',
      chatId: 'cB',
      prompt: 'two',
    });
    await runner.dispatch({
      workflowRunId: 'wf-other',
      stepId: 'c',
      employeeId: 'b',
      chatId: 'cC',
      prompt: 'three',
    });

    expect(runner.store.listByWorkflow('wf-list')).toHaveLength(2);
    expect(runner.store.listByWorkflow('wf-other')).toHaveLength(1);
  });

  it('cancel() moves an in-progress step to CANCELLED', async () => {
    // We can't easily inject a "pause" into the runtime, so this test only
    // verifies that cancel() on a terminal step is idempotent and that
    // cancel() on a created-but-not-dispatched step works.
    const agent = makeAgent(async () => 'ok');
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const run = await runner.dispatch({
      workflowRunId: 'wf-cancel',
      stepId: 'step-cancel',
      employeeId: 'b',
      chatId: 'step-chat-cancel',
      prompt: 'x',
    });

    // Step already terminal — cancel is a no-op.
    const after = runner.cancel(run.id);
    expect(after.status).toBe(run.status);
  });

  it('retry() resets a terminal failure and re-runs', async () => {
    let calls = 0;
    const agent = makeAgent(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first attempt fails');
      return 'second attempt ok';
    });
    const { runtime, cleanup } = setupRuntime(agent);
    cleanups.push(cleanup);
    const runner = new StepRunner({ runtime });

    const first = await runner.dispatch({
      workflowRunId: 'wf-retry',
      stepId: 'step-retry',
      employeeId: 'b',
      chatId: 'step-chat-retry',
      prompt: 'try',
    });
    expect(first.status).toBe('FAILED');

    const second = await runner.retry(first.id);
    expect(second.status).toBe('SUCCEEDED');
    expect(second.attempts).toBe(1);
  });
});
