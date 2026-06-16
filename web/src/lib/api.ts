import type { AgentObservability } from '../stores/chat';

/* ── Types ────────────────────────────────────────────────── */

export interface BotInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped';
  channel: string;
  workdir: string;
  model: string;
  tenant?: string;
  routingMode?: 'direct' | 'employee-director';
}

export interface ChatSummary {
  chatId: string;
  botName: string;
  label?: string;
  lastMessageAt: number;
  messageCount: number;
}

export interface WebChatConfig {
  welcomeTitle: string;
  welcomeSubtitle: string;
  inputPlaceholder: string;
  historyLimit: number;
  enableImageUpload: boolean;
  showSessionPicker: boolean;
  showQuickPrompts: boolean;
}

export interface HealthResponse {
  status: string;
  bots: BotInfo[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: string; size: number }>;
}

export interface WorkdirInfo {
  path: string;
}

export interface WorkdirSummary {
  path: string;
  info: WorkdirInfo;
  bots: BotInfo[];
}

export interface SkillStats {
  skillName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastCalledAt: number | null;
}

export interface AIInsight {
  id: string;
  createdAt: string;
  type: 'improve' | 'create' | 'merge' | 'retire';
  summary: string;
  details: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
}

export interface SessionInfo {
  chatId: string;
  messageCount: number;
  lastMessageAt: number;
  preview: string;
}

export type RuntimeEntryChannel = 'web' | 'dingtalk' | 'feishu' | 'harness' | 'builder_sandbox';
export type RuntimeSessionMode = 'single_employee' | 'workflow_group' | 'builder_sandbox';

export interface RuntimeEntry {
  id: string;
  tenant: string;
  channel: RuntimeEntryChannel;
  displayName: string;
  routingMode: 'direct' | 'employee-director' | 'workflow';
  enabled: boolean;
  configRef?: string;
}

export interface RuntimeActor {
  tenant: string;
  actorId: string;
  source: 'people' | 'platform_user' | 'web_impersonation' | 'anonymous' | 'harness';
  displayName?: string;
  peopleUserId?: string;
  platformUserId?: string;
  bindings: Array<{ employeeId: string; role?: string; isDefault?: boolean }>;
}

export interface RuntimeTarget {
  employeeId: string;
  displayName: string;
  role?: string;
  oneLiner?: string;
  isDefault: boolean;
}

export interface RuntimeSessionInfo {
  id: string;
  tenant: string;
  entryId: string;
  channel: RuntimeEntryChannel;
  actorId: string;
  chatId: string;
  employeeId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  mode: RuntimeSessionMode;
  title?: string;
  lastMessageAt: number;
  messageCount: number;
  preview: string;
  archivedAt?: number;
}

export interface RuntimeConversationSession {
  id: string;
  tenant: string;
  entryId: string;
  channel: RuntimeEntryChannel;
  actorId: string;
  chatId: string;
  employeeId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  mode: RuntimeSessionMode;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface RuntimeMessage {
  id: string;
  chatId: string;
  sessionId?: string;
  timestamp: number;
  botName?: string;
  tenant?: string;
  entryId?: string;
  actorId?: string;
  employeeId?: string;
  instanceId?: string;
  workdir?: string;
  mode?: RuntimeSessionMode;
  text: string;
  source: 'user' | 'bot' | 'self' | 'agent';
  fromBotName?: string;
  userId?: string;
  observability?: AgentObservability;
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

export interface RuntimeSendMessageBody {
  tenant: string;
  entryId: string;
  actorId: string;
  chatId: string;
  text: string;
  target?: {
    employeeId?: string;
    workflowThreadId?: string;
    draftId?: string;
  };
  attachments?: Array<{ data: string; mimeType: string }>;
  timeoutMs?: number;
}

export interface RuntimeSendMessageResult {
  reply: string;
  trace?: unknown;
  session: RuntimeConversationSession | null;
  runtime: {
    tenant: string;
    entryId: string;
    actorId: string;
    employeeId: string;
    instanceId: string;
    workdir: string;
    sdkSessionScope: string;
  };
}

export interface CreateRuntimeWorkflowBody {
  id?: string;
  tenant: string;
  entryId: string;
  actorId: string;
  ownerEmployeeId: string;
  participantEmployeeIds?: string[];
  parentSessionId?: string;
  title?: string;
  summary?: string;
}

export interface RuntimeWorkflowHandoffBody {
  fromEmployeeId: string;
  toEmployeeId: string;
  reason?: string;
  status?: WorkflowHandoffStatus;
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

export interface ScheduledTask {
  id: string;
  name: string;
  botName: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  runCount: number;
}

/* Business API types */

export interface BusinessAgent {
  name: string;
  displayName: string;
  status: 'running' | 'stopped';
  channel: string;
  workdir: string;
  model: string;
  sessionCount: number;
}

export interface BusinessAgentDetail extends BusinessAgent {
  sessions: string[];
}

export interface WorkflowTrace {
  id: string;
  entryAgent: string;
  prompt: string;
  success: boolean;
  summary: string;
  route: string[];
  handoffCount: number;
  steps: Array<{ from: string; to: string; action: string; timestamp: number; task?: string; reason?: string; payload?: Record<string, unknown> }>;
}

export interface HarnessStepRun {
  id: string;
  input: {
    workflowRunId: string;
    stepId: string;
    employeeId: string;
    tenant?: string;
    userId?: string;
    chatId: string;
    prompt: string;
    expectedArtifacts?: string[];
  };
  status: string;
  failureClass?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  reply?: string;
  error?: string;
  attempts: number;
}

export interface EmployeeTemplate {
  role: string;
  hasWorkdir: boolean;
  hasRoleTemplate: boolean;
}

export interface TenantMeta {
  id: string;
  displayName: string;
  description?: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  employeeCount: number;
  version?: string;
}

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  version?: string;
  segments?: string[];
  defaultRoleOrder?: string[];
  businessObjects?: string[];
  roles?: string[];
  defaultWorkflows?: string[];
}

export interface TemplateVersion {
  id: string;
  label: string;
  createdAt: string;
  path: string;
}

export interface RolePromptTemplate {
  identity: string;
  responsibilities: string[];
  boundaries: string[];
}

export interface HandoffTarget {
  role: string;
  when: string;
  contract?: string;
}

export interface RoleTemplate {
  id: string;
  industry: string;
  role: string;
  displayName: string;
  description: string;
  prompt: RolePromptTemplate;
  requiredCapabilities: string[];
  skills: string[];
  handoffTargets: HandoffTarget[];
  renderedPrompt?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  role: string;
  description: string;
  triggerExamples: string[];
  steps: string[];
  missingInfoPolicy: string;
  output?: Record<string, unknown>;
}

export interface ContractTemplate {
  id: string;
  fromRole: string;
  toRole: string;
  description: string;
  requiredFields: Record<string, string>;
  optionalFields: Record<string, string>;
}

export interface TemplateDetail {
  template: TemplateMeta & { employees?: Array<{ template: string; role: string }> };
  industry?: IndustryTemplate;
  roles: Record<string, RoleTemplate>;
  workflows: Record<string, WorkflowTemplate>;
  contracts: Record<string, ContractTemplate>;
  versions?: TemplateVersion[];
  employeeYamls: Record<string, string>;
  rolesJson?: Record<string, unknown>;
}

export interface HarnessCaseSummary {
  id: string;
  description?: string;
  file: string;
  input: {
    channel: string;
    botName: string;
    tenant?: string;
    userId?: string;
    handoffMode?: 'auto' | 'disabled';
  };
  expect: {
    routedEmployee?: string;
    selectorShown?: boolean;
    handoffCount?: number;
    toolNamesIncludes?: string[];
    toolNamesExcludes?: string[];
    memoryWorkspaceContains?: string;
    noErrors?: boolean;
  };
}

export interface HarnessTrace {
  input: {
    channel: string;
    botName: string;
    tenant?: string;
    userId?: string;
    chatId: string;
    messageId?: string;
  };
  routing: {
    mode?: string;
    selectedEmployee?: string;
    boundEmployee?: string;
    selectorShown?: boolean;
  };
  toolCalls: Array<{ name: string; status: string; elapsedMs?: number }>;
  memory: Array<{ operation: string; subject: string; workspace?: string; status: string }>;
  handoffs: Array<{ from: string; to: string; reason?: string }>;
  businessArtifacts: Array<{ type: string; id?: string; status: string }>;
  errors: Array<{ stage: string; message: string }>;
  startedAt: number;
  finishedAt?: number;
}

export interface HarnessCaseResult {
  case: {
    id: string;
    description?: string;
    input: HarnessCaseSummary['input'] & { chatId: string; messageId?: string; text: string };
    expect: HarnessCaseSummary['expect'] & {
      replyContains?: string[];
      replyEquals?: string;
    };
  };
  status: 'passed' | 'failed' | 'error';
  failures: Array<{ expectation: string; expected: unknown; actual: unknown }>;
  ingress?: {
    reply: string;
    trace: HarnessTrace;
  };
  error?: string;
}

export interface HarnessSuiteReport {
  id: string;
  createdAt: string;
  summary: { passed: number; failed: number; total: number };
  results: HarnessCaseResult[];
  text: string;
}

export interface EmployeeImportResult {
  imported: string[];
  skipped: string[];
  count: number;
}

export interface EnterprisePerson {
  userId: string;
  name: string;
  departments: Array<{ id: string; name: string }>;
  /** @deprecated Use entryEmployee/routingMode/visibleEmployees. */
  role?: string;
  /** @deprecated Use entryEmployee/routingMode/visibleEmployees. */
  assistantId?: string;
  roleBindings?: Array<{ role: string; assistantId: string }>;
  status: 'active' | 'inactive';
  source: 'dingtalk' | 'manual';
  syncedAt: number;
  updatedAt: number;
  entryEmployee?: string;
  routingMode?: 'bound' | 'selector';
  visibleEmployees?: string[];
}

export interface BotBinding {
  botName: string;
  botDisplayName: string;
  channel: string;
  status: 'running' | 'stopped';
  workdir: string;
  employeeId: string | null;
  employeeDisplayName: string | null;
  tenant: string | null;
}

export interface AgentBuilderIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface AgentBuilderValidation {
  ok: boolean;
  issues: AgentBuilderIssue[];
}

export interface AgentBuilderDraft {
  id: string;
  tenant: string;
  source: 'natural_language' | 'template' | 'fork' | 'manual';
  status: 'draft' | 'validated' | 'tested' | 'published';
  createdAt: number;
  updatedAt: number;
  input?: {
    naturalLanguage?: string;
    templateId?: string;
    sourceEmployeeId?: string;
  };
  employee: Employee;
  validation: AgentBuilderValidation;
  harness?: {
    yaml: string;
    lastResult?: 'passed' | 'failed' | 'error';
    failures?: string[];
  };
  sandbox?: {
    lastSessionId: string;
    lastResult: 'passed' | 'failed' | 'error';
    reply?: string;
    testedAt: number;
    fingerprint: string;
  };
}

export interface CreateAgentBuilderDraftBody {
  tenant: string;
  source: AgentBuilderDraft['source'];
  prompt?: string;
  templateId?: string;
  role?: string;
  sourceEmployeeId?: string;
}

export interface AgentBuilderOptions {
  tenant: string;
  skills: Array<{ name: string; displayName: string; description: string; toolCount: number }>;
  tools: Array<{ name: string; appName: string; description: string; riskLevel: 'read' | 'internal_write' | 'destructive' | 'external' }>;
  employees: Array<{ id: string; displayName: string; role: string; workspace: string }>;
}

export interface AgentBuilderSandboxMessageBody {
  actorId?: string;
  chatId?: string;
  text: string;
  timeoutMs?: number;
}

export interface AgentBuilderSandboxMessageResult {
  draft: AgentBuilderDraft;
  session: RuntimeConversationSession;
  reply: string;
  trace?: unknown;
}

export interface EmployeeCapabilityReport {
  tenant: string;
  employeeId: string;
  displayName: string;
  role: string;
  workspace: {
    relative: string;
    absolute: string;
    hasClaudeMd: boolean;
  };
  promptSource: {
    yamlSystemPrompt: boolean;
    workspaceClaudeMd: boolean;
  };
  capabilities: string[];
  skills: Array<{
    name: string;
    displayName: string;
    description: string;
    installed: boolean;
    toolCount: number;
    allowed: boolean;
    reason?: string;
  }>;
  tools: Array<{
    name: string;
    appName: string;
    description: string;
    riskLevel: string;
    registered: boolean;
    allowed: boolean;
    requiresConfirmation?: boolean;
    reason?: string;
  }>;
  handoffTargets: Array<{
    employeeId: string;
    displayName?: string;
    exists: boolean;
  }>;
  mcpBoundary: {
    platformMcpVisible: boolean;
    businessMcpDirectVisible: boolean;
    businessInterface: 'run_skill' | 'app-tools-legacy';
  };
  summary: {
    skillCount: number;
    toolCount: number;
    allowedToolCount: number;
    highRiskToolCount: number;
    handoffTargetCount: number;
    warningCount: number;
  };
  warnings: string[];
}

/* ── Demo API types ──────────────────────────────────── */

export interface Employee {
  id: string;
  displayName: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  role: string;
  allowedTargets?: string[];
  capabilities: string[];
  workspace: string;
  humanUserId?: string;
  schedule?: unknown;
  source: 'generated' | 'prepopulated' | 'forked';
  createdAt: number;
  hasFallbackLevel1: boolean;
  hasFallbackLevel2: boolean;
  toolCount: number;
  skillCount: number;
  fallbackLevel2?: FormFallback;
  tenantName?: string;
}

export interface AgentGraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: 'agent' | 'tool' | 'skill' | 'fallback' | 'human';
    agentId?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
    type: 'data-flow' | 'handoff' | 'fallback' | 'tool-call';
  }>;
}

export interface StatsSummary {
  totalAgents: number;
  totalSkills: number;
  totalFallbacks: number;
  agentsByRole: Record<string, number>;
}

export interface OptimizationResult {
  id: string;
  displayName: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  rationale: string;
  originalAgentIds: string[];
}

export interface GenerationResponse {
  agent: Employee;
  warnings: string[];
  rawYaml: string;
  fallbackLevel2?: FormFallback;
}

export interface BusinessChannel {
  name: string;
  botCount: number;
  bots: Array<{ name: string; displayName: string; status: string }>;
}

/* ── Form workflow types ───────────────────────────── */

export interface FormFallback {
  workflowId: string;
  name: string;
  steps: FormWorkflowStep[];
  status: 'ai-suggested' | 'user-confirmed' | 'active';
}

export interface FormWorkflowStep {
  stepId: string;
  type: 'form' | 'approval' | 'notification' | 'document';
  title: string;
  assigneeRole: string;
  fields: FormFormField[];
  condition?: string;
}

export interface FormFormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'signature' | 'file';
  required: boolean;
  options?: string[];
}

/* ── API client ───────────────────────────────────────────── */

import { getToken, clearToken } from './auth';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  /* Auth */
  login: (token: string) =>
    fetch('/api/admin/session', { headers: { Authorization: `Bearer ${token}` } }).then((res) => {
      if (!res.ok) throw new Error('Invalid token');
    }),
  checkAdminSession: () => request<{ authenticated: boolean; mode: 'protected' | 'development' }>('/api/admin/session'),

  /* Health / bots */
  health: () => request<HealthResponse>('/api/health'),

  /* Chats */
  listChats: () => request<ChatSummary[]>('/api/chats'),
  getWebChatConfig: () => request<WebChatConfig>('/api/web-chat/config'),

  /* Skills */
  listSkills: (tenant?: string) =>
    request<SkillInfo[]>(`/api/admin/skills${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`),

  /* Workdir Skills */
  listWorkdirSkills: (workdirPath: string) =>
    request<Array<{ name: string; hasSkillMd: boolean; fileCount: number }>>(`/api/admin/workdir-skills?path=${encodeURIComponent(workdirPath)}`),
  readWorkdirSkill: (workdirPath: string, name: string) =>
    request<{ name: string; content: string; exists: boolean; otherFiles: string[] }>(`/api/admin/workdir-skills/${encodeURIComponent(name)}?path=${encodeURIComponent(workdirPath)}`),
  writeWorkdirSkill: (workdirPath: string, name: string, content: string) =>
    request<{ updated: boolean }>(`/api/admin/workdir-skills/${encodeURIComponent(name)}?path=${encodeURIComponent(workdirPath)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  /* Reverse: which bots/employees have this skill */
  listBotsBySkill: (skillName: string) =>
    request<BotInfo[]>(`/api/admin/skills/${encodeURIComponent(skillName)}/bots`),
  listEmployeesBySkill: (skillName: string) =>
    request<Array<{ id: string; displayName: string; role: string; tenant: string }>>(`/api/admin/skills/${encodeURIComponent(skillName)}/employees`),

  /* Bind / unbind skills to a bot */
  patchEmployeeSkills: (botName: string, body: { add?: string[]; remove?: string[] }) =>
    request<Array<{ name: string; hasSkillMd: boolean; fileCount: number }>>(`/api/admin/employees/${encodeURIComponent(botName)}/skills`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /* Workdir */
  listWorkdirs: () =>
    request<WorkdirSummary[]>('/api/admin/workdirs'),
  loadWorkdir: (workdirPath: string) =>
    request<WorkdirInfo>(`/api/admin/workdir/${encodeURIComponent(workdirPath)}`),

  /* Bot management */
  clearBotSessions: (name: string) =>
    request<{ name: string; cleared: number }>(`/api/admin/bots/${encodeURIComponent(name)}/clear-sessions`, { method: 'POST' }),
  listBotSessions: (name: string) =>
    request<{ sessions: SessionInfo[] }>(`/api/admin/bots/${encodeURIComponent(name)}/sessions`),
  clearBotSession: (name: string, chatId: string) =>
    request<{ cleared: boolean }>(`/api/admin/bots/${encodeURIComponent(name)}/sessions/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
  listBotBindings: () =>
    request<{ bindings: BotBinding[]; employees: Array<{ id: string; displayName: string; tenant: string; workspace: string }> }>('/api/admin/bot-bindings'),
  bindBotToEmployee: (botName: string, employeeId: string | null) =>
    request<{ binding: { botName: string; employeeId: string | null; tenant?: string; employeeWorkspace?: string } }>(`/api/admin/bot-bindings/${encodeURIComponent(botName)}`, {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    }),

  /* Runtime */
  listRuntimeEntries: (tenant?: string) => {
    const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : '';
    return request<{ entries: RuntimeEntry[] }>(`/api/runtime/entries${qs}`);
  },
  listRuntimeActors: (tenant: string, entryId?: string) => {
    const params = new URLSearchParams({ tenant });
    if (entryId) params.set('entryId', entryId);
    return request<{ actors: RuntimeActor[] }>(`/api/runtime/actors?${params.toString()}`);
  },
  listRuntimeTargets: (tenant: string, actorId: string, entryId?: string) => {
    const params = new URLSearchParams({ tenant, actorId });
    if (entryId) params.set('entryId', entryId);
    return request<{ targets: RuntimeTarget[] }>(`/api/runtime/targets?${params.toString()}`);
  },
  listRuntimeSessions: (filter: { tenant?: string; entryId?: string; actorId?: string; employeeId?: string; mode?: RuntimeSessionMode; includeArchived?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (filter.tenant) params.set('tenant', filter.tenant);
    if (filter.entryId) params.set('entryId', filter.entryId);
    if (filter.actorId) params.set('actorId', filter.actorId);
    if (filter.employeeId) params.set('employeeId', filter.employeeId);
    if (filter.mode) params.set('mode', filter.mode);
    if (filter.includeArchived !== undefined) params.set('includeArchived', String(filter.includeArchived));
    if (filter.limit) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    const qs = params.toString();
    return request<{ sessions: RuntimeSessionInfo[] }>(`/api/runtime/sessions${qs ? `?${qs}` : ''}`);
  },
  getRuntimeSession: (sessionId: string) =>
    request<{ session: RuntimeConversationSession }>(`/api/runtime/sessions/${encodeURIComponent(sessionId)}`),
  getRuntimeSessionMessages: (sessionId: string, limit = 100) =>
    request<{ session: RuntimeConversationSession; messages: RuntimeMessage[] }>(
      `/api/runtime/sessions/${encodeURIComponent(sessionId)}/messages?limit=${encodeURIComponent(String(limit))}`,
    ),
  listRuntimeCases: (filter: { tenant?: string; includeArchived?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filter.tenant) params.set('tenant', filter.tenant);
    if (filter.includeArchived !== undefined) params.set('includeArchived', String(filter.includeArchived));
    if (filter.limit) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return request<{ cases: WorkflowCase[] }>(`/api/runtime/cases${qs ? `?${qs}` : ''}`);
  },
  getRuntimeCaseTimeline: (caseId: string) =>
    request<{ case: WorkflowCase; timeline: WorkflowTimelineEvent[] }>(`/api/runtime/cases/${encodeURIComponent(caseId)}/timeline`),
  archiveRuntimeSession: (sessionId: string) =>
    request<{ archived: boolean; session: RuntimeConversationSession }>(
      `/api/runtime/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    ),
  sendRuntimeMessage: (body: RuntimeSendMessageBody) =>
    request<RuntimeSendMessageResult>('/api/runtime/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listRuntimeWorkflows: (filter: { tenant?: string; actorId?: string; state?: WorkflowThreadState; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filter.tenant) params.set('tenant', filter.tenant);
    if (filter.actorId) params.set('actorId', filter.actorId);
    if (filter.state) params.set('state', filter.state);
    if (filter.limit) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return request<{ workflows: WorkflowThread[] }>(`/api/runtime/workflows${qs ? `?${qs}` : ''}`);
  },
  getRuntimeWorkflow: (workflowId: string) =>
    request<{ workflow: WorkflowThread; session: RuntimeConversationSession | null }>(`/api/runtime/workflows/${encodeURIComponent(workflowId)}`),
  createRuntimeWorkflow: (body: CreateRuntimeWorkflowBody) =>
    request<{ workflow: WorkflowThread; session: RuntimeConversationSession | null }>('/api/runtime/workflows', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  handoffRuntimeWorkflow: (workflowId: string, body: RuntimeWorkflowHandoffBody) =>
    request<{ workflow: WorkflowThread }>(
      `/api/runtime/workflows/${encodeURIComponent(workflowId)}/handoff`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  sendRuntimeWorkflowMessage: (workflowId: string, body: { text: string; targetEmployeeId?: string; timeoutMs?: number }) =>
    request<{ workflow: WorkflowThread; session: RuntimeConversationSession | null; reply: string; trace?: unknown }>(
      `/api/runtime/workflows/${encodeURIComponent(workflowId)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /* Agent Builder */
  listAgentBuilderDrafts: () =>
    request<{ drafts: AgentBuilderDraft[] }>('/api/agent-builder/drafts'),
  getAgentBuilderOptions: (tenant: string) =>
    request<AgentBuilderOptions>(`/api/agent-builder/options?tenant=${encodeURIComponent(tenant)}`),
  getAgentBuilderDraftCapabilities: (draftId: string) =>
    request<{ capability: EmployeeCapabilityReport }>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}/capabilities`),
  createAgentBuilderDraft: (body: CreateAgentBuilderDraftBody) =>
    request<{ draft: AgentBuilderDraft }>('/api/agent-builder/drafts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAgentBuilderDraft: (draftId: string, draft: AgentBuilderDraft) =>
    request<{ draft: AgentBuilderDraft }>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}`, {
      method: 'PUT',
      body: JSON.stringify(draft),
    }),
  validateAgentBuilderDraft: (draftId: string) =>
    request<{ draft: AgentBuilderDraft; validation: AgentBuilderValidation }>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}/validate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  testAgentBuilderDraft: (draftId: string) =>
    request<{ draft: AgentBuilderDraft; result: { status: 'passed' | 'failed'; failures: Array<{ expectation: string; expected: unknown; actual: unknown }> } }>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}/test`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  sendAgentBuilderSandboxMessage: (draftId: string, body: AgentBuilderSandboxMessageBody) =>
    request<AgentBuilderSandboxMessageResult>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}/sandbox/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  publishAgentBuilderDraft: (draftId: string) =>
    request<{ draft: AgentBuilderDraft; yamlPath: string; workspacePath: string; colonyRegistered: boolean }>(`/api/agent-builder/drafts/${encodeURIComponent(draftId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /* Capability registry */
  listCapabilities: (tenant?: string) =>
    request<{ employees: EmployeeCapabilityReport[] }>(`/api/admin/capabilities${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`),
  getEmployeeCapability: (tenant: string, employeeId: string) =>
    request<{ employee: EmployeeCapabilityReport }>(`/api/admin/capabilities/${encodeURIComponent(tenant)}/${encodeURIComponent(employeeId)}`),

  /* Knowledge base (legacy per-bot) */
  listKnowledgeFiles: (botName: string) =>
    request<{ files: Array<{ name: string; size: number }>; path: string }>(`/api/admin/bots/${encodeURIComponent(botName)}/knowledge`),
  deleteKnowledgeFile: (botName: string, filename: string) =>
    request<{ deleted: boolean }>(`/api/admin/bots/${encodeURIComponent(botName)}/knowledge/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  /* Three-tier knowledge */
  listKnowledgeCards: (params: { tenant: string; employee?: string }) => {
    const qs = new URLSearchParams({ tenant: params.tenant });
    if (params.employee) qs.set('employee', params.employee);
    return request<{ cards: Array<{ name: string; tier: string; tierId: string; size: number; updatedAt: string }>; tiers: string[] }>(`/api/admin/knowledge?${qs.toString()}`);
  },
  readKnowledgeCard: (params: { tenant: string; tier: string; tierId: string; name: string }) =>
    request<{ name: string; tier: string; content: string; updatedAt: string }>(
      `/api/admin/knowledge/${encodeURIComponent(params.tier)}/${encodeURIComponent(params.name)}?tenant=${encodeURIComponent(params.tenant)}&tierId=${encodeURIComponent(params.tierId)}`,
    ),
  writeKnowledgeCard: (params: { tenant: string; tier: string; tierId: string; name: string; content: string }) =>
    request<{ created?: boolean; updated?: boolean }>(
      `/api/admin/knowledge/${encodeURIComponent(params.tier)}/${encodeURIComponent(params.name)}?tenant=${encodeURIComponent(params.tenant)}&tierId=${encodeURIComponent(params.tierId)}`,
      { method: 'PUT', body: JSON.stringify({ content: params.content }) },
    ),

  /* Memory */
  listMemorySources: (botName: string, tenant?: string) =>
    request<{ data: Array<{ file: string; type: string; size: number }> }>(
      `/api/admin/memory/${encodeURIComponent(botName)}/sources${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`,
    ),
  searchMemory: (botName: string, query: string, tenant?: string) =>
    request<{ data: Array<{ file: string; line: number; context: string }> }>(
      `/api/admin/memory/${encodeURIComponent(botName)}/search?q=${encodeURIComponent(query)}${tenant ? `&tenant=${encodeURIComponent(tenant)}` : ''}`,
    ),
  readMemoryFile: (botName: string, filePath: string, tenant?: string) =>
    request<{ data: string }>(
      `/api/admin/memory/${encodeURIComponent(botName)}/file?path=${encodeURIComponent(filePath)}${tenant ? `&tenant=${encodeURIComponent(tenant)}` : ''}`,
    ),
  writeMemoryFile: (botName: string, filePath: string, content: string, tenant?: string) =>
    request<{ success: boolean }>(`/api/admin/memory/${encodeURIComponent(botName)}/file${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content }),
    }),

  /* Harness */
  listHarnessCases: (tenant?: string) =>
    request<{ fixtureDir: string; cases: HarnessCaseSummary[] }>(`/api/admin/harness/cases${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`),
  runHarnessSuite: (caseIds?: string[]) =>
    request<{ report: HarnessSuiteReport }>('/api/admin/harness/run-suite', {
      method: 'POST',
      body: JSON.stringify({ caseIds }),
    }),
  runHarnessStep: (body: {
    workflowRunId?: string;
    stepId?: string;
    employeeId: string;
    tenant?: string;
    userId?: string;
    chatId?: string;
    prompt: string;
    expectedArtifacts?: string[];
  }) =>
    request<{ run: HarnessStepRun }>('/api/admin/harness/run-step', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listHarnessStepRuns: (workflowRunId?: string) =>
    request<{ runs: HarnessStepRun[] }>(`/api/admin/harness/step-runs${workflowRunId ? `?workflowRunId=${encodeURIComponent(workflowRunId)}` : ''}`),
  getLatestHarnessReport: () =>
    request<{ report: HarnessSuiteReport | null }>('/api/admin/harness/reports/latest'),

  /* Admin */
  clearMessages: () =>
    request<{ cleared: number }>('/api/admin/clear-messages', { method: 'POST' }),


  /* Analytics */
  getSkillStats: () =>
    request<SkillStats[]>('/api/admin/analytics/skills'),

  /* Insights */
  generateInsights: () =>
    request<AIInsight[]>('/api/admin/insights/generate', { method: 'POST' }),
  listInsights: (status?: string) =>
    request<AIInsight[]>(`/api/admin/insights${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  updateInsightStatus: (id: string, status: AIInsight['status']) =>
    request<{ id: string; status: string }>(`/api/admin/insights/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  /* Scheduler */
  listScheduledTasks: () =>
    request<ScheduledTask[]>('/api/admin/scheduler/tasks'),
  createScheduledTask: (body: {
    name: string;
    botName: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    prompt: string;
    enabled?: boolean;
  }) =>
    request<ScheduledTask>('/api/admin/scheduler/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateScheduledTask: (id: string, patch: Partial<{
    name: string;
    botName: string;
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    enabled: boolean;
  }>) =>
    request<ScheduledTask>(`/api/admin/scheduler/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteScheduledTask: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/scheduler/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  triggerScheduledTask: (id: string) =>
    request<{ success: boolean }>(`/api/admin/scheduler/tasks/${encodeURIComponent(id)}/trigger`, { method: 'POST' }),

  /* Setup (no auth) */
  getSetupStatus: () =>
    fetch('/api/setup/status').then((r) => r.json()) as Promise<{
      configured: boolean;
      needsApiKey: boolean;
      hasBots: boolean;
    }>,
  getBootstrapStatus: () =>
    request<{ configured: boolean; steps: { modelConfigured: boolean; employeeNetworkReady: boolean; peopleBound: boolean } }>('/api/setup/status'),
  saveSetupConfig: (body: {
    apiKey?: string;
    baseUrl?: string;
    authToken?: string;
    model?: string;
    webChat?: Partial<WebChatConfig>;
    bots?: Array<{
      name: string;
      channel: string;
      credentials: Record<string, string>;
      displayName: string;
      tenant?: string;
      routingMode?: 'direct' | 'employee-director';
      groupReplyMode?: 'mention-only' | 'all';
    }>;
  }) =>
    fetch('/api/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()) as Promise<{ success: boolean; error?: string }>,

  /* Admin config (view-only for now) */
  getConfig: () =>
    request<Record<string, unknown>>('/api/admin/config'),

  revealAdminConfig: () =>
    request<Record<string, unknown>>('/api/admin/config/reveal', { method: 'POST' }),

  saveAdminConfig: (body: {
    apiKey?: string;
    baseUrl?: string;
    authToken?: string;
    model?: string;
    webChat?: Partial<WebChatConfig>;
    bots?: Array<{
      name: string;
      channel?: string;
      credentials?: Record<string, string>;
      displayName?: string;
      agentDir?: string;
      cwd?: string;
      model?: string;
      baseUrl?: string;
      authToken?: string;
      tenant?: string;
      routingMode?: 'direct' | 'employee-director';
      groupReplyMode?: 'mention-only' | 'all';
    }>;
  }) =>
    fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()) as Promise<{ success: boolean; error?: string }>,

  verifyBot: (body: { name?: string; channel?: string; credentials?: Record<string, string> }) =>
    request<{ ok: boolean; error?: string; channel?: string; botOpenId?: string }>('/api/admin/verify-bot', {
      method: 'POST', body: JSON.stringify(body),
    }),

  verifyModel: (body: { baseUrl: string; authToken: string; model?: string }) =>
    request<{ ok: boolean; error?: string; model?: string }>('/api/admin/verify-model', {
      method: 'POST', body: JSON.stringify(body),
    }),

  /* Business API */
  listBusinessAgents: () =>
    request<{ agents: BusinessAgent[] }>('/api/business/agents'),
  getBusinessAgent: (name: string) =>
    request<BusinessAgentDetail>(`/api/business/agents/${encodeURIComponent(name)}`),
  listBusinessChannels: () =>
    request<{ channels: BusinessChannel[] }>('/api/business/channels'),
  clearBusinessAgentSessions: (name: string) =>
    request<{ name: string; cleared: number }>(`/api/business/agents/${encodeURIComponent(name)}/clear-sessions`, { method: 'POST' }),

  listTenants: () =>
    request<{ tenants: TenantMeta[] }>('/api/tenants'),

  /* ── Employee API ──────────────────────────────────────── */
  listEnterprisePeople: (tenant?: string) =>
    request<{ people: EnterprisePerson[] }>(`/api/enterprise-people${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`),
  syncEnterprisePeople: (tenant?: string) =>
    request<{ people: EnterprisePerson[]; sync: { created: number; updated: number; inactive: number; total: number } }>(
      `/api/enterprise-people/sync${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`,
      { method: 'POST' },
    ),
  bindEnterprisePerson: (userId: string, body: {
    tenant?: string;
    role?: string | null;
    assistantId?: string | null;
    entryEmployee?: string;
    routingMode?: 'bound' | 'selector';
    visibleEmployees?: string[];
  }) =>
    request<{ person: EnterprisePerson }>(
      `/api/enterprise-people/${encodeURIComponent(userId)}/bind${body.tenant ? `?tenant=${encodeURIComponent(body.tenant)}` : ''}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listEmployees: (tenant?: string) =>
    request<{ employees: Employee[] }>(`/api/employees${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`),
  generateEmployee: (body: { description: string; tenant?: string }) =>
    request<GenerationResponse>('/api/employees/generate', {
      method: 'POST', body: JSON.stringify(body),
    }),
  optimizeEmployees: (body: { agentIds: string[]; goal: string }) =>
    request<{ result: OptimizationResult }>('/api/employees/optimize', {
      method: 'POST', body: JSON.stringify(body),
    }),
  getEmployeeGraph: () =>
    request<{ graph: AgentGraphData }>('/api/employees/graph'),
  forkEmployee: (body: { sourceAgentId: string; personName: string; personRole: string; humanUserId?: string; tenant?: string }) =>
    request<{ agent: Employee }>('/api/employees/fork', {
      method: 'POST', body: JSON.stringify(body),
    }),
  listEmployeeTemplates: () =>
    request<{ templates: EmployeeTemplate[] }>('/api/employees/templates'),
  getEmployeeStats: () =>
    request<{ stats: StatsSummary }>('/api/employees/stats'),
  seedEmployees: (body?: { tenant?: string }) =>
    request<{ agents: Employee[]; count: number }>('/api/employees/seed', {
      method: 'POST', body: JSON.stringify(body || {}),
    }),
  importEmployees: (body: {
    sourcePath: string;
    tenant?: string;
    employeeDrafts?: Array<{
      id?: string;
      displayName: string;
      role: string;
      description?: string;
      skillNames: string[];
    }>;
  }) =>
    request<EmployeeImportResult>('/api/employees/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTraces: () =>
    request<{ traces: Array<{
      id: string; entryAgent: string; prompt: string; success: boolean;
      summary: string; route: string[]; handoffCount: number;
      steps: Array<{ from: string; to: string; action: string; timestamp: number }>;
    }> }>('/api/employees/traces'),

  /* ── Template API ──────────────────────────────────────── */
  listTemplates: () =>
    request<{ templates: TemplateMeta[] }>('/api/templates'),
  getTemplate: (id: string) =>
    request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}`),
  cloneTemplate: (id: string, body: { id: string; name: string; description?: string }) =>
    request<{ template: TemplateMeta }>(`/api/templates/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  publishTemplateVersion: (id: string, body: { label?: string }) =>
    request<{ version: TemplateVersion }>(`/api/templates/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  saveTemplateIndustry: (templateId: string, industry: IndustryTemplate) =>
    request<{ industry: IndustryTemplate }>(`/api/templates/${encodeURIComponent(templateId)}/industry`, {
      method: 'PUT',
      body: JSON.stringify(industry),
    }),
  saveTemplateRole: (templateId: string, roleId: string, role: RoleTemplate) =>
    request<{ role: RoleTemplate }>(`/api/templates/${encodeURIComponent(templateId)}/roles/${encodeURIComponent(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify(role),
    }),
  saveTemplateContract: (templateId: string, contractId: string, contract: ContractTemplate) =>
    request<{ contract: ContractTemplate }>(`/api/templates/${encodeURIComponent(templateId)}/contracts/${encodeURIComponent(contractId)}`, {
      method: 'PUT',
      body: JSON.stringify(contract),
    }),
  instantiateTemplate: (id: string, body: { tenantName: string; nameMap?: Record<string, string> }) =>
    request<{ tenant: string; files: string[] }>(`/api/templates/${encodeURIComponent(id)}/instantiate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ── Workdir API ──────────────────────────────────────── */
  scanWorkdir: (path: string) =>
    request<{ path: string; skills: Array<{ name: string; description: string; path: string; dependencies?: unknown; hasWriteOps: boolean }>; scripts: Array<{ path: string; relativePath: string; executable: boolean }>; runtimeDependencies: { hasPackageJson: boolean; hasRequirementsTxt: boolean; pythonPackages: string[]; nodePackages: string[] } }>(
      `/api/admin/workdir/scan?path=${encodeURIComponent(path)}`,
    ),
  validateWorkdirSkill: (body: { workdir: string; skillPath: string }) =>
    request<{
      valid: boolean;
      errors: Array<{ path: string; severity: 'error'; message: string }>;
      warnings: Array<{ path: string; severity: 'warning'; message: string }>;
    }>('/api/admin/workdir/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* Orchestration */
  listOrchestrationTraces: () =>
    request<{ traces: WorkflowTrace[] }>('/api/orchestration/traces'),
};
