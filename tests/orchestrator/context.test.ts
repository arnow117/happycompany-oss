import { describe, it, expect } from 'vitest';
import {
  WorkflowHistory,
  WorkflowContext,
  AllowedTargets,
} from '../../src/orchestrator/context.js';
import { OrchestrationConfig } from '../../src/orchestrator/config.js';

// ── WorkflowHistory ─────────────────────────────────────

describe('WorkflowHistory', () => {
  it('starts empty', () => {
    const history = new WorkflowHistory();
    expect(history.steps).toEqual([]);
    expect(history.totalSteps).toBe(0);
  });

  it('records steps and exposes them', () => {
    const history = new WorkflowHistory();
    history.record('agent-a', 'agent-b');
    history.record('agent-b', 'agent-c');

    expect(history.steps).toHaveLength(2);
    expect(history.steps[0]).toEqual({
      from: 'agent-a',
      to: 'agent-b',
      timestamp: expect.any(Number),
    });
    expect(history.steps[1]).toEqual({
      from: 'agent-b',
      to: 'agent-c',
      timestamp: expect.any(Number),
    });
    expect(history.totalSteps).toBe(2);
  });

  it('getRoute() returns ordered list of from/to pairs', () => {
    const history = new WorkflowHistory();
    history.record('agent-a', 'agent-b');
    history.record('agent-b', 'agent-c');

    const route = history.getRoute();
    expect(route).toEqual(['agent-a->agent-b', 'agent-b->agent-c']);
  });

  it('getRoute() returns empty array when no steps', () => {
    const history = new WorkflowHistory();
    expect(history.getRoute()).toEqual([]);
  });
});

// ── WorkflowContext ─────────────────────────────────────

describe('WorkflowContext', () => {
  it('initializes with entry agent and zero counters', () => {
    const ctx = new WorkflowContext('greeter', 'hello');

    expect(ctx.entryAgent).toBe('greeter');
    expect(ctx.currentAgent).toBe('greeter');
    expect(ctx.inputText).toBe('hello');
    expect(ctx.handoffCount).toBe(0);
    expect(ctx.iterationCount).toBe(0);
  });

  it('initializes with optional context object', () => {
    const ctx = new WorkflowContext('greeter', 'hello', { tenantId: 't-1' });
    expect(ctx.context).toEqual({ tenantId: 't-1' });
  });

  it('incrementIteration() increments the counter', () => {
    const ctx = new WorkflowContext('greeter', 'hello');
    expect(ctx.iterationCount).toBe(0);

    ctx.incrementIteration();
    expect(ctx.iterationCount).toBe(1);

    ctx.incrementIteration();
    expect(ctx.iterationCount).toBe(2);
  });

  it('incrementHandoff() increments the counter', () => {
    const ctx = new WorkflowContext('greeter', 'hello');
    expect(ctx.handoffCount).toBe(0);

    ctx.incrementHandoff();
    expect(ctx.handoffCount).toBe(1);
  });

  it('has a history instance', () => {
    const ctx = new WorkflowContext('greeter', 'hello');
    expect(ctx.history).toBeInstanceOf(WorkflowHistory);
  });
});

// ── AllowedTargets ─────────────────────────────────────

describe('AllowedTargets', () => {
  it('fromList creates instance with given agents', () => {
    const targets = AllowedTargets.fromList(['agent-a', 'agent-b']);
    expect(targets.size).toBe(2);
    expect(targets.isAllowed('agent-a')).toBe(true);
    expect(targets.isAllowed('agent-b')).toBe(true);
    expect(targets.isAllowed('agent-c')).toBe(false);
  });

  it('isAllowed returns false for unknown agent', () => {
    const targets = AllowedTargets.fromList(['agent-a']);
    expect(targets.isAllowed('unknown')).toBe(false);
  });

  it('add() adds a new target', () => {
    const targets = AllowedTargets.fromList(['agent-a']);
    targets.add('agent-b');
    expect(targets.isAllowed('agent-b')).toBe(true);
    expect(targets.size).toBe(2);
  });

  it('remove() removes a target', () => {
    const targets = AllowedTargets.fromList(['agent-a', 'agent-b']);
    targets.remove('agent-a');
    expect(targets.isAllowed('agent-a')).toBe(false);
    expect(targets.size).toBe(1);
  });

  it('getAll() returns all target names', () => {
    const targets = AllowedTargets.fromList(['agent-a', 'agent-b', 'agent-c']);
    expect(targets.getAll()).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });

  it('is iterable via Symbol.iterator', () => {
    const targets = AllowedTargets.fromList(['agent-a', 'agent-b']);
    const result: string[] = [];
    for (const agent of targets) {
      result.push(agent);
    }
    expect(result).toEqual(['agent-a', 'agent-b']);
  });
});

// ── OrchestrationConfig ────────────────────────────────

describe('OrchestrationConfig', () => {
  it('provides default values', () => {
    const config = new OrchestrationConfig();
    expect(config.maxHandoffs).toBe(10);
    expect(config.maxIterations).toBe(50);
    expect(config.sessionTimeout).toBe(300);
    expect(config.enableLoopDetection).toBe(true);
    expect(config.enableAuditLog).toBe(true);
  });

  it('accepts custom overrides', () => {
    const config = new OrchestrationConfig({
      maxHandoffs: 5,
      maxIterations: 100,
      sessionTimeout: 600,
      enableLoopDetection: false,
    });
    expect(config.maxHandoffs).toBe(5);
    expect(config.maxIterations).toBe(100);
    expect(config.sessionTimeout).toBe(600);
    expect(config.enableLoopDetection).toBe(false);
    expect(config.enableAuditLog).toBe(true); // default preserved
  });
});
