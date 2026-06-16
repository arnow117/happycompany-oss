import type { StepRun, StepRunStatus, FailureClass, StepRunHeartbeat } from './step-run.js';
import { canTransition } from './step-run.js';

/**
 * In-memory store for Step Runs. The long-task spec (§R12, §R13) eventually
 * persists these into the ContractStore, but Phase 1 only requires status
 * transitions and trace association — in-memory is enough.
 */
export class StepRunStore {
  private readonly byId = new Map<string, StepRun>();

  put(run: StepRun): void {
    this.byId.set(run.id, run);
  }

  get(id: string): StepRun | undefined {
    return this.byId.get(id);
  }

  list(): StepRun[] {
    return [...this.byId.values()];
  }

  listByWorkflow(workflowRunId: string): StepRun[] {
    return this.list().filter((r) => r.input.workflowRunId === workflowRunId);
  }

  /**
   * Transition a step to a new status. Returns the updated step. Throws if
   * the transition is not allowed by the spec §R1 state machine.
   */
  transition(
    id: string,
    next: StepRunStatus,
    patch: Partial<{
      failureClass: FailureClass;
      ackedAt: number;
      startedAt: number;
      finishedAt: number;
      reply: string;
      error: string;
      trace: StepRun['trace'];
    }> = {},
  ): StepRun {
    const current = this.byId.get(id);
    if (!current) throw new Error(`StepRun not found: ${id}`);
    if (!canTransition(current.status, next)) {
      throw new Error(`Illegal transition ${current.status} → ${next} for ${id}`);
    }
    const updated: StepRun = {
      ...current,
      ...patch,
      status: next,
    };
    this.byId.set(id, updated);
    return updated;
  }

  appendHeartbeat(id: string, hb: StepRunHeartbeat): StepRun {
    const current = this.byId.get(id);
    if (!current) throw new Error(`StepRun not found: ${id}`);
    const updated: StepRun = {
      ...current,
      heartbeats: [...current.heartbeats, hb],
    };
    this.byId.set(id, updated);
    return updated;
  }
}
