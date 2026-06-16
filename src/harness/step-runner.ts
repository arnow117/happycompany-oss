import { MessageIngressRuntime } from '../ingress/runtime.js';
import type { IngressMessageInput } from '../ingress/types.js';
import type { ConversationMode, RuntimeMessageInput, RuntimeProfile } from '../runtime-profile.js';
import type { IngressTrace } from '../ingress/types.js';
import {
  DEFAULT_PROTOCOL,
  type StepRun,
  type StepRunInput,
  type StepRunProtocol,
} from './step-run.js';
import { StepRunStore } from './step-run-store.js';

interface StepRunnerDeps {
  runtime: MessageIngressRuntime;
  runtimeResolver?: { resolve(input: RuntimeMessageInput): RuntimeProfile };
  store?: StepRunStore;
  protocol?: Partial<StepRunProtocol>;
  /** Override clock for tests. */
  clock?: () => number;
  /** Override id generator for tests. */
  idGenerator?: () => string;
}

export interface DispatchResult {
  run: StepRun;
  trace?: IngressTrace;
}

/**
 * Phase 1 of docs/specs/2026-05-25-agent-harness-requirements.md.
 *
 * Dispatches one step against the MessageIngressRuntime and applies the
 * ackTimeout / stallTimeout protocol. Does NOT yet:
 *   - Cross-step Workflow orchestration (§R4 / §R5)
 *   - Independent Evaluator gates (§R7 / §R8 / §R9)
 *   - Preflight failure classes beyond TIMEOUT (§R10)
 *   - ContractStore persistence (§R13)
 *   - Reviewer benchmark (§R14 / §R15)
 *
 * Those are intentional non-goals for this slice — see the spec for the
 * five-phase implementation plan.
 */
export class StepRunner {
  readonly store: StepRunStore;
  private readonly runtime: MessageIngressRuntime;
  private readonly runtimeResolver?: { resolve(input: RuntimeMessageInput): RuntimeProfile };
  private readonly protocol: StepRunProtocol;
  private readonly clock: () => number;
  private readonly idGen: () => string;

  constructor(deps: StepRunnerDeps) {
    this.runtime = deps.runtime;
    this.runtimeResolver = deps.runtimeResolver;
    this.store = deps.store ?? new StepRunStore();
    this.protocol = { ...DEFAULT_PROTOCOL, ...(deps.protocol ?? {}) };
    this.clock = deps.clock ?? (() => Date.now());
    this.idGen = deps.idGenerator ?? (() => crypto.randomUUID());
  }

  /**
   * Create + dispatch a step in one call. Resolves when the agent finishes,
   * the ackTimeout fires, the stallTimeout fires, or the agent throws.
   */
  async dispatch(input: StepRunInput): Promise<StepRun> {
    const id = `step-${this.idGen()}`;
    const baseProtocol: StepRunProtocol = { ...this.protocol };
    const run: StepRun = {
      id,
      input,
      protocol: baseProtocol,
      status: 'CREATED',
      createdAt: this.clock(),
      heartbeats: [],
      attempts: 0,
    };
    this.store.put(run);
    return this.runOnce(id);
  }

  /** Re-dispatch an existing step (used by manual takeover / retry). */
  async retry(stepId: string): Promise<StepRun> {
    const existing = this.store.get(stepId);
    if (!existing) throw new Error(`StepRun not found: ${stepId}`);
    // Reset to CREATED only if terminal. Otherwise reject — caller must
    // cancel first.
    if (!['FAILED', 'TIMED_OUT', 'STALLED'].includes(existing.status)) {
      throw new Error(`Cannot retry ${stepId} from status ${existing.status}`);
    }
    const reset: StepRun = {
      ...existing,
      status: 'CREATED',
      attempts: existing.attempts + 1,
      failureClass: undefined,
      reply: undefined,
      error: undefined,
      ackedAt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      heartbeats: [],
    };
    this.store.put(reset);
    return this.runOnce(stepId);
  }

  cancel(stepId: string): StepRun {
    const current = this.store.get(stepId);
    if (!current) throw new Error(`StepRun not found: ${stepId}`);
    if (['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'STALLED', 'CANCELLED'].includes(current.status)) {
      return current;
    }
    return this.store.transition(stepId, 'CANCELLED', { finishedAt: this.clock() });
  }

  private async runOnce(id: string): Promise<StepRun> {
    const run = this.store.get(id)!;

    this.store.transition(id, 'DISPATCHED', {});
    this.store.put({ ...this.store.get(id)!, dispatchedAt: this.clock() });

    type RuntimeOutcome =
      | { kind: 'result'; ingress: { reply: string; trace: IngressTrace } }
      | { kind: 'error'; message: string; trace?: IngressTrace };
    type RaceOutcome =
      | { kind: 'runtime'; outcome: RuntimeOutcome }
      | { kind: 'ack-timeout' }
      | { kind: 'stall-timeout' };

    const ac = new AbortController();
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const ackPromise = new Promise<RaceOutcome>((resolve) => {
      ackTimer = setTimeout(() => resolve({ kind: 'ack-timeout' }), run.protocol.ackTimeoutMs);
    });
    const stallPromise = new Promise<RaceOutcome>((resolve) => {
      stallTimer = setTimeout(() => resolve({ kind: 'stall-timeout' }), run.protocol.stallTimeoutMs);
    });

    const runtimePromise: Promise<RuntimeOutcome> = (async () => {
      this.store.transition(id, 'ACKED', { ackedAt: this.clock() });
      this.store.transition(id, 'RUNNING', { startedAt: this.clock() });
      try {
        const ingress = await this.runtime.handle(
          this.buildIngressInput(run),
          {
            abortController: ac,
            handoffMode: 'disabled',
            onText: (t) =>
              this.store.appendHeartbeat(id, { at: this.clock(), progressSummary: t.slice(0, 200) }),
            onToolStart: (info) =>
              this.store.appendHeartbeat(id, { at: this.clock(), lastToolCall: info.toolName }),
          },
        );
        return { kind: 'result' as const, ingress };
      } catch (err) {
        return {
          kind: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
          trace: (err as Error & { trace?: IngressTrace }).trace,
        };
      }
    })();

    // Swallow eventual rejection if we abandon the promise on timeout — the
    // Runtime is contracted to either resolve or reject; either way we don't
    // care after a timeout decided the outcome.
    runtimePromise.catch(() => {});

    const racedRuntime: Promise<RaceOutcome> = runtimePromise.then((outcome) => ({
      kind: 'runtime' as const,
      outcome,
    }));

    const winner = await Promise.race([racedRuntime, ackPromise, stallPromise]);
    if (ackTimer) clearTimeout(ackTimer);
    if (stallTimer) clearTimeout(stallTimer);

    const now = this.clock();
    const statusBeforeFinal = this.store.get(id)!.status;

    if (winner.kind === 'ack-timeout' && statusBeforeFinal === 'DISPATCHED') {
      ac.abort();
      return this.store.transition(id, 'TIMED_OUT', {
        failureClass: 'TIMEOUT',
        finishedAt: now,
        error: 'ack timeout',
      });
    }
    if (winner.kind === 'stall-timeout' && statusBeforeFinal === 'RUNNING') {
      ac.abort();
      return this.store.transition(id, 'STALLED', {
        failureClass: 'STALLED',
        finishedAt: now,
        error: 'stall timeout',
      });
    }

    // If a timeout fired but the status had moved past the relevant gate, we
    // still need the runtime's actual outcome. The race already polled the
    // runtime promise; if it hasn't resolved, wait briefly with no extra gate.
    const finalOutcome: RuntimeOutcome =
      winner.kind === 'runtime' ? winner.outcome : await runtimePromise;

    if (finalOutcome.kind === 'error') {
      return this.store.transition(id, 'FAILED', {
        failureClass: 'QUALITY_GATE_FAILED',
        finishedAt: now,
        error: finalOutcome.message,
        trace: finalOutcome.trace,
      });
    }

    const missing = (run.input.expectedArtifacts ?? []).filter(
      (artifact) => !finalOutcome.ingress.reply.includes(artifact),
    );
    if (missing.length > 0) {
      return this.store.transition(id, 'FAILED', {
        failureClass: 'QUALITY_GATE_FAILED',
        finishedAt: now,
        error: `Missing artifacts: ${missing.join(', ')}`,
        reply: finalOutcome.ingress.reply,
        trace: finalOutcome.ingress.trace,
      });
    }

    return this.store.transition(id, 'SUCCEEDED', {
      finishedAt: now,
      reply: finalOutcome.ingress.reply,
      trace: finalOutcome.ingress.trace,
    });
  }

  private buildIngressInput(run: StepRun): IngressMessageInput {
    const runtimeInput = run.input.runtime;
    if (!runtimeInput) {
      if (!run.input.employeeId) {
        throw new Error('employeeId is required when StepRun runtime input is not provided');
      }
      return {
        channel: 'harness',
        botName: run.input.employeeId,
        tenant: run.input.tenant,
        userId: run.input.userId,
        chatId: run.input.chatId,
        text: run.input.prompt,
      };
    }

    const mode: ConversationMode = runtimeInput.mode ?? 'single_employee';
    if (this.runtimeResolver) {
      const profile = this.runtimeResolver.resolve({
        tenant: runtimeInput.tenant,
        entryId: runtimeInput.entryId,
        actorId: runtimeInput.actorId,
        chatId: run.input.chatId,
        text: run.input.prompt,
        target: runtimeInput.target ?? (run.input.employeeId ? { employeeId: run.input.employeeId } : undefined),
      });
      return {
        channel: profile.entry.channel,
        botName: profile.employee.id,
        tenant: profile.tenant,
        entryId: profile.entry.id,
        actorId: profile.actor.actorId,
        userId: profile.actor.peopleUserId ?? profile.actor.actorId,
        chatId: run.input.chatId,
        sessionId: profile.instance.sdkSessionScope,
        employeeId: profile.employee.id,
        instanceId: profile.instance.instanceId,
        workdir: profile.instance.workdir,
        sdkSessionScope: profile.instance.sdkSessionScope,
        mode,
        text: run.input.prompt,
      };
    }

    if (runtimeInput.resolved) {
      return {
        channel: runtimeInput.resolved.channel ?? 'harness',
        botName: runtimeInput.resolved.employeeId,
        tenant: runtimeInput.tenant,
        entryId: runtimeInput.entryId,
        actorId: runtimeInput.actorId,
        userId: runtimeInput.resolved.userId ?? run.input.userId ?? runtimeInput.actorId,
        chatId: run.input.chatId,
        sessionId: runtimeInput.resolved.sdkSessionScope,
        employeeId: runtimeInput.resolved.employeeId,
        instanceId: runtimeInput.resolved.instanceId,
        workdir: runtimeInput.resolved.workdir,
        sdkSessionScope: runtimeInput.resolved.sdkSessionScope,
        mode,
        text: run.input.prompt,
      };
    }

    throw new Error('StepRun runtime input requires a runtimeResolver or runtime.resolved fields');
  }
}
