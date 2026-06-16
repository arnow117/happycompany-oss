import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../src/harness/evaluator.js';

/**
 * evaluator.ts is the Plan §6 Phase 7 deliverable — "Evaluator Gate 可以复用
 * Harness adapter 的 trace 断言机制". These tests pin the public contract of
 * `evaluateGate`: the three-verdict surface (PASS / NEEDS_REVISION / BLOCKED)
 * that future Reviewer-employee work (spec §R7–R9) will swap in without
 * changing call sites.
 */
describe('evaluateGate', () => {
  it('returns PASS when expect matches the StepRun trace', () => {
    const run = {
      reply: 'shipped',
      trace: {
        input: { channel: 'harness' as const, botName: 'b', chatId: 'c' },
        routing: {},
        toolCalls: [],
        memory: [],
        handoffs: [],
        businessArtifacts: [],
        errors: [],
        startedAt: 0,
      },
    };
    const evaluation = evaluateGate(
      { name: 'g', targetStepId: 's', expect: { replyContains: ['shipped'] } },
      {
        id: 's',
        input: { workflowRunId: 'w', stepId: 's', employeeId: 'e', chatId: 'c', prompt: 'p' },
        protocol: { ackTimeoutMs: 1, stallTimeoutMs: 1 },
        status: 'SUCCEEDED',
        createdAt: 0,
        heartbeats: [],
        attempts: 0,
        reply: run.reply,
        trace: run.trace,
      },
    );
    expect(evaluation.verdict).toBe('PASS');
    expect(evaluation.failures).toEqual([]);
  });

  it('returns BLOCKED when target step is missing', () => {
    const evaluation = evaluateGate(
      { name: 'g', targetStepId: 'nope', expect: {} },
      undefined,
    );
    expect(evaluation.verdict).toBe('BLOCKED');
    expect(evaluation.reason).toContain('nope');
  });

  it('returns BLOCKED when target step has no trace', () => {
    const evaluation = evaluateGate(
      { name: 'g', targetStepId: 's', expect: {} },
      {
        id: 's',
        input: { workflowRunId: 'w', stepId: 's', employeeId: 'e', chatId: 'c', prompt: 'p' },
        protocol: { ackTimeoutMs: 1, stallTimeoutMs: 1 },
        status: 'TIMED_OUT',
        createdAt: 0,
        heartbeats: [],
        attempts: 0,
      },
    );
    expect(evaluation.verdict).toBe('BLOCKED');
    expect(evaluation.reason).toContain('IngressTrace');
  });

  it('returns NEEDS_REVISION (not BLOCKED) when trace present but expectation fails', () => {
    const evaluation = evaluateGate(
      { name: 'g', targetStepId: 's', expect: { replyContains: ['XYZ'] } },
      {
        id: 's',
        input: { workflowRunId: 'w', stepId: 's', employeeId: 'e', chatId: 'c', prompt: 'p' },
        protocol: { ackTimeoutMs: 1, stallTimeoutMs: 1 },
        status: 'SUCCEEDED',
        createdAt: 0,
        heartbeats: [],
        attempts: 0,
        reply: 'no x y z here',
        trace: {
          input: { channel: 'harness', botName: 'b', chatId: 'c' },
          routing: {},
          toolCalls: [],
          memory: [],
          handoffs: [],
          businessArtifacts: [],
          errors: [],
          startedAt: 0,
        },
      },
    );
    expect(evaluation.verdict).toBe('NEEDS_REVISION');
    expect(evaluation.failures).toHaveLength(1);
    expect(evaluation.failures[0].expectation).toContain('XYZ');
  });
});
