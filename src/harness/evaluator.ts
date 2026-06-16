import type { IngressResult } from '../ingress/types.js';
import {
  type HarnessAssertionFailure,
  type HarnessCaseExpect,
  assertHarnessExpect,
} from '../ingress/adapters/harness.js';
import type { StepRun } from './step-run.js';

/**
 * Plan §6 Phase 7 — "Evaluator Gate 可以复用 Harness adapter 的 trace 断言机制".
 *
 * An Evaluator does NOT spin up a separate reviewer employee in this phase
 * (spec §R7–R9 reviewer employees are a future milestone). It is simply a
 * named `HarnessCaseExpect` block applied against the target step's
 * IngressTrace + reply. The verdict mirrors spec §R8 vocabulary so future
 * reviewer-employee work can layer on without renaming.
 */
export interface EvaluatorGate {
  /** Stable label for reporting. */
  name: string;
  /** Step id (within the workflow) whose output is being graded. */
  targetStepId: string;
  /** Assertions to run against the target's IngressResult. */
  expect: HarnessCaseExpect;
  /** Optional human description for debugging / docs. */
  description?: string;
}

export type EvaluationVerdict = 'PASS' | 'NEEDS_REVISION' | 'BLOCKED';

export interface EvaluationResult {
  gate: EvaluatorGate;
  verdict: EvaluationVerdict;
  failures: HarnessAssertionFailure[];
  /** Why the gate was BLOCKED (missing trace, missing step, etc.). */
  reason?: string;
}

/**
 * Evaluate one gate against one step. Pure function — no side effects on the
 * step. The workflow runner is responsible for halting / branching based on
 * the verdict.
 */
export function evaluateGate(gate: EvaluatorGate, target: StepRun | undefined): EvaluationResult {
  if (!target) {
    return {
      gate,
      verdict: 'BLOCKED',
      failures: [],
      reason: `Target step "${gate.targetStepId}" not found`,
    };
  }
  if (!target.trace || target.reply === undefined) {
    return {
      gate,
      verdict: 'BLOCKED',
      failures: [],
      reason: `Target step "${gate.targetStepId}" has no IngressTrace (status=${target.status})`,
    };
  }
  const ingress: IngressResult = { reply: target.reply, trace: target.trace };
  const failures = assertHarnessExpect(gate.expect, ingress);
  return {
    gate,
    verdict: failures.length === 0 ? 'PASS' : 'NEEDS_REVISION',
    failures,
  };
}
