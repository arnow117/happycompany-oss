import type { EmployeeDefinition } from './orchestrator/employee-schema.js';
import type { IngressAttachment } from './ingress/types.js';

export type EntryChannel = 'web' | 'dingtalk' | 'feishu' | 'harness' | 'builder_sandbox';

export interface EntryEndpoint {
  id: string;
  tenant: string;
  channel: EntryChannel;
  displayName: string;
  routingMode: 'direct' | 'employee-director' | 'workflow';
  enabled: boolean;
  configRef?: string;
}

export interface ActorBinding {
  employeeId: string;
  role?: string;
  isDefault?: boolean;
}

export interface ActorIdentity {
  tenant: string;
  actorId: string;
  source: 'people' | 'platform_user' | 'web_impersonation' | 'anonymous' | 'harness';
  displayName?: string;
  peopleUserId?: string;
  platformUserId?: string;
  bindings: ActorBinding[];
}

export interface RuntimeTarget {
  employeeId?: string;
  workflowThreadId?: string;
  draftId?: string;
}

export interface RuntimeInstance {
  tenant: string;
  employeeId: string;
  actorId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  source: 'published_employee' | 'draft_overlay';
}

export interface RuntimeProfile {
  tenant: string;
  entry: EntryEndpoint;
  actor: ActorIdentity;
  employee: EmployeeDefinition;
  instance: RuntimeInstance;
  instructions: {
    systemPrompt: string;
    claudeMdPath?: string;
    rules: string[];
    handoffConditions: string[];
  };
  tools: {
    allowed: string[];
    denied: string[];
    riskWarnings: string[];
  };
  skills: string[];
  memory: {
    namespace: string;
    workdir: string;
  };
}

export type ConversationMode = 'single_employee' | 'workflow_group' | 'builder_sandbox';

export interface ConversationSession {
  id: string;
  tenant: string;
  entryId: string;
  channel: EntryChannel;
  actorId: string;
  chatId: string;
  employeeId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  mode: ConversationMode;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface RuntimeMessageInput {
  tenant: string;
  entryId: string;
  channel?: EntryChannel;
  actorId: string;
  chatId: string;
  text: string;
  attachments?: IngressAttachment[];
  target?: RuntimeTarget;
}

export interface RuntimeSessionSummary {
  id: string;
  tenant: string;
  entryId: string;
  channel: EntryChannel;
  actorId: string;
  chatId: string;
  employeeId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  mode: ConversationMode;
  title?: string;
  lastMessageAt: number;
  messageCount: number;
  preview: string;
  archivedAt?: number;
}

export type RuntimeEventType =
  | 'user_message'
  | 'routing_decision'
  | 'agent_message'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'handoff_requested'
  | 'memory_op'
  | 'business_artifact'
  | 'error';

export interface RuntimeEvent {
  id: string;
  tenant?: string;
  sessionId?: string;
  chatId: string;
  actorId?: string;
  employeeId?: string;
  type: RuntimeEventType;
  payload: Record<string, unknown>;
  at: number;
}

export interface RuntimeEventFilter {
  tenant?: string;
  sessionId?: string;
  chatId?: string;
  limit?: number;
}

export type WorkflowCaseState = 'active' | 'completed' | 'failed' | 'archived';

export interface WorkflowCase {
  id: string;
  tenant: string;
  sessionId: string;
  entryId: string;
  actorId: string;
  chatId: string;
  title?: string;
  state: WorkflowCaseState;
  currentEmployeeId: string;
  participants: string[];
  handoffCount: number;
  toolCallCount: number;
  lastMessageAt: number;
  messageCount: number;
  preview: string;
  archivedAt?: number;
}

export type WorkflowTimelineEventType =
  | 'user_message'
  | 'agent_message'
  | 'routing_decision'
  | 'tool_call'
  | 'handoff'
  | 'memory'
  | 'business_artifact'
  | 'error';

export interface WorkflowTimelineEvent {
  id: string;
  type: WorkflowTimelineEventType;
  at: number;
  employeeId?: string;
  fromEmployeeId?: string;
  toEmployeeId?: string;
  text?: string;
  toolName?: string;
  status?: string;
  artifactType?: string;
  artifactId?: string;
  reason?: string;
  stage?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface RuntimeTargetOption {
  employeeId: string;
  displayName: string;
  role?: string;
  oneLiner?: string;
  isDefault: boolean;
}

export type WorkflowParticipantRole = 'owner' | 'participant' | 'observer';
export type WorkflowThreadState = 'open' | 'waiting' | 'completed' | 'cancelled';
export type WorkflowHandoffStatus = 'requested' | 'accepted' | 'completed' | 'failed';

export interface WorkflowParticipant {
  employeeId: string;
  instanceId: string;
  role: WorkflowParticipantRole;
  joinedAt: number;
}

export interface WorkflowHandoffEvent {
  fromEmployeeId: string;
  toEmployeeId: string;
  reason?: string;
  status: WorkflowHandoffStatus;
  at: number;
}

export interface WorkflowThread {
  id: string;
  tenant: string;
  sessionId: string;
  parentSessionId?: string;
  entryId: string;
  actorId: string;
  ownerEmployeeId: string;
  state: WorkflowThreadState;
  participants: WorkflowParticipant[];
  handoffs: WorkflowHandoffEvent[];
  summary?: string;
  createdAt: number;
  updatedAt: number;
}
