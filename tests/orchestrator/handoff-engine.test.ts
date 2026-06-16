import { describe, test, expect, vi } from 'vitest';
import { DynamicHandoffOrchestrator } from '../../src/orchestrator/handoff-engine.js';
import type { AgentProtocol, AgentResponse } from '../../src/orchestrator/types.js';
import { AgentResponse as AgentResponseClass } from '../../src/orchestrator/types.js';
import { HandoffRequest } from '../../src/orchestrator/handoff.js';
import {
  SecurityError,
  AgentNotFoundError,
  MaxIterationsError,
  LoopDetectionError,
} from '../../src/orchestrator/errors.js';

// ── Test Helpers ──────────────────────────────────────────

function makeAgent(name: string, responses: AgentResponse[]): AgentProtocol {
  let callIndex = 0;
  return {
    name,
    execute: vi.fn(async (): Promise<AgentResponse> => {
      const response = responses[callIndex];
      callIndex += 1;
      return response;
    }),
  };
}

function doneResponse(text: string, data: Record<string, unknown> = {}): AgentResponse {
  return new AgentResponseClass(text, null, true, data);
}

function handoffResponse(text: string, target: string, payload: Record<string, unknown> = {}): AgentResponse {
  const request = new HandoffRequest(target, { event: 'handoff', ...payload });
  return new AgentResponseClass(text, request, false, {});
}

// ── Tests ─────────────────────────────────────────────────

describe('DynamicHandoffOrchestrator', () => {
  describe('single agent to completion', () => {
    test('returns success when agent returns done=true', async () => {
      const agentA = makeAgent('a', [doneResponse('done')]);
      const orch = new DynamicHandoffOrchestrator(['a']);
      orch.register(agentA);

      const result = await orch.run('a', 'hello');

      expect(result.success).toBe(true);
      expect(result.finalResponse?.text).toBe('done');
      expect(result.finalResponse?.done).toBe(true);
      expect(result.stats.handoffCount).toBe(0);
      expect(result.stats.iterationCount).toBe(1);
    });
  });

  describe('handoff chain a->b->c', () => {
    test('follows handoff chain and returns final result', async () => {
      const agentA = makeAgent('a', [handoffResponse('to b', 'b')]);
      const agentB = makeAgent('b', [handoffResponse('to c', 'c')]);
      const agentC = makeAgent('c', [doneResponse('final')]);

      const orch = new DynamicHandoffOrchestrator(['a', 'b', 'c']);
      orch.registerMultiple([agentA, agentB, agentC]);

      const result = await orch.run('a', 'start');

      expect(result.success).toBe(true);
      expect(result.finalResponse?.text).toBe('final');
      expect(result.stats.handoffCount).toBe(2);
      expect(result.history.route).toEqual(['a->b', 'b->c']);
      expect(result.history.totalSteps).toBe(2);
    });
  });

  describe('SecurityError for unauthorized entry agent', () => {
    test('throws SecurityError when entry agent is not in allowed targets', async () => {
      const agentA = makeAgent('a', [doneResponse('done')]);
      const orch = new DynamicHandoffOrchestrator(['b']); // only 'b' allowed
      orch.register(agentA);

      const error = await orch.run('a', 'hello').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as Error).message).toMatch(/not authorized/i);
    });
  });

  describe('SecurityError for unauthorized handoff target', () => {
    test('throws SecurityError when handoff target is not in allowed targets', async () => {
      const agentA = makeAgent('a', [handoffResponse('go', 'x')]);
      const orch = new DynamicHandoffOrchestrator(['a']); // 'x' not allowed
      orch.register(agentA);

      const error = await orch.run('a', 'hello').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as Error).message).toMatch(/not authorized/i);
    });
  });

  describe('AgentNotFoundError for unregistered agent', () => {
    test('throws AgentNotFoundError when agent is allowed but not registered', async () => {
      const orch = new DynamicHandoffOrchestrator(['a']); // 'a' is allowed but not registered

      await expect(orch.run('a', 'hello')).rejects.toThrow(AgentNotFoundError);
    });

    test('throws AgentNotFoundError on handoff to unregistered agent', async () => {
      const agentA = makeAgent('a', [handoffResponse('go', 'b')]);
      const orch = new DynamicHandoffOrchestrator(['a', 'b']); // 'b' allowed
      orch.register(agentA); // but 'b' not registered

      await expect(orch.run('a', 'hello')).rejects.toThrow(AgentNotFoundError);
    });
  });

  describe('MaxIterationsError when loop limit exceeded', () => {
    test('throws MaxIterationsError when iterations exceed config limit', async () => {
      // Agent that never finishes but also never hands off
      const neverDone = makeAgent('a', [
        new AgentResponseClass('still going', null, false, {}),
        new AgentResponseClass('still going', null, false, {}),
        new AgentResponseClass('still going', null, false, {}),
      ]);

      const orch = new DynamicHandoffOrchestrator(['a'], { maxIterations: 2 });
      orch.register(neverDone);

      await expect(orch.run('a', 'hello')).rejects.toThrow(MaxIterationsError);
    });
  });

  describe('LoopDetectionError when handoff limit exceeded', () => {
    test('throws LoopDetectionError when handoffs exceed config limit', async () => {
      // Two agents that keep handing off to each other
      const agentA = makeAgent('a', [
        handoffResponse('to b', 'b'),
        handoffResponse('to b', 'b'),
        handoffResponse('to b', 'b'),
      ]);
      const agentB = makeAgent('b', [
        handoffResponse('to a', 'a'),
        handoffResponse('to a', 'a'),
        handoffResponse('to a', 'a'),
      ]);

      const orch = new DynamicHandoffOrchestrator(['a', 'b'], { maxHandoffs: 3 });
      orch.registerMultiple([agentA, agentB]);

      await expect(orch.run('a', 'hello')).rejects.toThrow(LoopDetectionError);
    });
  });

  describe('success=false on agent execution error', () => {
    test('returns success=false when agent execute throws', async () => {
      const failingAgent: AgentProtocol = {
        name: 'a',
        execute: vi.fn(async (): Promise<AgentResponse> => {
          throw new Error('agent crashed');
        }),
      };

      const orch = new DynamicHandoffOrchestrator(['a']);
      orch.register(failingAgent);

      const result = await orch.run('a', 'hello');

      expect(result.success).toBe(false);
      expect(result.finalResponse).toBeNull();
    });
  });

  describe('registration helpers', () => {
    test('isRegistered returns true for registered agents', () => {
      const agent = makeAgent('x', [doneResponse('ok')]);
      const orch = new DynamicHandoffOrchestrator(['x']);
      orch.register(agent);

      expect(orch.isRegistered('x')).toBe(true);
      expect(orch.isRegistered('y')).toBe(false);
    });

    test('getRegisteredAgents returns all registered agent names', () => {
      const a = makeAgent('a', [doneResponse('a')]);
      const b = makeAgent('b', [doneResponse('b')]);
      const orch = new DynamicHandoffOrchestrator(['a', 'b']);
      orch.registerMultiple([a, b]);

      const names = orch.getRegisteredAgents();
      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toHaveLength(2);
    });
  });
});
