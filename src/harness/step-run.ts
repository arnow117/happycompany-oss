import type { IngressTrace } from '../ingress/types.js';
import type { ConversationMode, EntryChannel, RuntimeTarget } from '../runtime-profile.js';

/** Per spec docs/specs/2026-05-25-agent-harness-requirements.md §R1. */
export type StepRunStatus =
  | 'CREATED'
  | 'DISPATCHED'
  | 'ACKED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'STALLED'
  | 'BLOCKED'
  | 'CANCELLED';

/** Per spec §R11. */
export type FailureClass =
  | 'PRECONDITION_FAILED'
  | 'AUTH_BLOCKED'
  | 'ENV_MISSING'
  | 'TOOL_UNAVAILABLE'
  | 'QUALITY_GATE_FAILED'
  | 'TIMEOUT'
  | 'STALLED'
  | 'RISK_BLOCKED';

export interface StepRunRuntimeInput {
  tenant: string;
  entryId: string;
  actorId: string;
  target?: RuntimeTarget;
  mode?: ConversationMode;
  /** Offline/fake fallback when no RuntimeResolver is available. */
  resolved?: {
    channel?: EntryChannel;
    employeeId: string;
    instanceId: string;
    workdir: string;
    sdkSessionScope: string;
    userId?: string;
  };
}

export interface StepRunInput {
  workflowRunId: string;
  stepId: string;
  /** Legacy direct bot id. Prefer runtime.target.employeeId for new cases. */
  employeeId?: string;
  /** Tenant scope of the workflow. */
  tenant?: string;
  /** Human/system identity that the step is being run for. */
  userId?: string;
  /** Runtime-profile entry input. Resolves employee/workdir/session consistently with Web/IM. */
  runtime?: StepRunRuntimeInput;
  /** Chat id used by the ingress runtime for message persistence. */
  chatId: string;
  /** Task brief that the employee will receive. */
  prompt: string;
  /** Required output artifacts. Step is marked QUALITY_GATE_FAILED if missing. */
  expectedArtifacts?: string[];
}

export interface StepRunProtocol {
  ackTimeoutMs: number;
  stallTimeoutMs: number;
  heartbeatIntervalMs?: number;
  maxRetries?: number;
}

export interface StepRunHeartbeat {
  at: number;
  progressSummary?: string;
  currentArtifact?: string;
  lastToolCall?: string;
  lastError?: string;
}

export interface StepRun {
  id: string;
  input: StepRunInput;
  protocol: StepRunProtocol;
  status: StepRunStatus;
  failureClass?: FailureClass;
  createdAt: number;
  dispatchedAt?: number;
  ackedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  heartbeats: StepRunHeartbeat[];
  trace?: IngressTrace;
  reply?: string;
  error?: string;
  attempts: number;
}

/** Status transitions allowed by spec §R1. Anything not in here is rejected. */
const ALLOWED_TRANSITIONS: Record<StepRunStatus, StepRunStatus[]> = {
  CREATED: ['DISPATCHED', 'CANCELLED', 'BLOCKED'],
  DISPATCHED: ['ACKED', 'TIMED_OUT', 'CANCELLED', 'FAILED'],
  ACKED: ['RUNNING', 'FAILED', 'CANCELLED', 'STALLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'STALLED', 'CANCELLED'],
  // Terminal states — empty.
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
  STALLED: [],
  BLOCKED: [],
  CANCELLED: [],
};

export function canTransition(from: StepRunStatus, to: StepRunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const DEFAULT_PROTOCOL: StepRunProtocol = {
  ackTimeoutMs: 300_000,
  stallTimeoutMs: 1_200_000,
  heartbeatIntervalMs: 60_000,
  maxRetries: 2,
};
