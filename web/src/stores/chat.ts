import { create } from 'zustand';
import type { StreamEvent } from '../types/stream-event';

/* ── Types ─────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  chatId: string;
  text: string;
  source: 'user' | 'bot';
  botName?: string;
  timestamp: number;
  attachments?: Array<{ type: string; data: string; mimeType: string }>;
  observability?: AgentObservability;
}

export interface AgentObservability {
  summary: {
    status: 'completed' | 'failed' | 'interrupted';
    stopReason?: string | null;
    errors?: string[];
    permissionDenials?: Array<{ toolName: string; toolUseId: string }>;
  };
  init?: {
    sessionId: string;
    model: string;
    cwd: string;
    tools: string[];
    mcpServers: Array<{ name: string; status: string }>;
    skills: string[];
    plugins: Array<{ name: string; path: string }>;
    permissionMode: string;
    claudeCodeVersion: string;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    durationMs: number;
    apiDurationMs?: number;
    numTurns: number;
    modelUsage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }>;
  };
  toolCalls: Array<{
    toolName: string;
    toolUseId: string;
    parentToolUseId?: string | null;
    elapsedMs?: number;
    input?: Record<string, unknown>;
    status: 'running' | 'completed';
  }>;
  handoffs: Array<{
    from: string;
    to: string;
    reason?: string;
    status?: 'pending' | 'completed' | 'failed';
    result?: string;
    contractId?: string;
    parentContractId?: string;
  }>;
  startedAt: number;
  finishedAt: number;
}

export interface ToolInfo {
  toolName: string;
  toolUseId: string;
  startTime: number;
  elapsedSeconds?: number;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  toolInput?: Record<string, unknown>;
}

export interface StreamingState {
  isStreaming: boolean;
  partialText: string;
  thinkingText: string;
  isThinking: boolean;
  thinkingDurationMs: number;
  activeTools: ToolInfo[];
  systemStatus?: string;
  recentEvents: StreamingTimelineEvent[];
  collaborations: CollaborationEvent[];
  todos: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  interrupted: boolean;
}

export interface CollaborationEvent {
  from: string;
  to: string;
  reason?: string;
  status: 'pending' | 'completed' | 'failed';
  result?: string;
  contractId?: string;
  parentContractId?: string;
  timestamp: number;
  completedAt?: number;
}

export interface StreamingTimelineEvent {
  type: string;
  text?: string;
  timestamp: number;
  toolName?: string;
  toolUseId?: string;
  elapsedSeconds?: number;
}

export interface WorkdirOption {
  id: string;
  displayName: string;
  path: string;
  channels: string[];
  status?: string;
  tenant?: string;
}

export interface TenantOption {
  id: string;
  displayName: string;
  description?: string;
}

export interface RuntimeChatContext {
  tenant?: string;
  entryId?: string;
  actorId?: string;
  targetEmployeeId?: string;
  sessionId?: string;
  chatId?: string;
}

/** @deprecated Use WorkdirOption */
export interface BotOption {
  name: string;
  displayName: string;
  online?: boolean;
}

/* ── Store ─────────────────────────────────────────────── */

interface ChatState {
  // Connection
  connected: boolean;
  wsRef: React.RefObject<WebSocket | null>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;

  // Messages
  messages: ChatMessage[];
  loadingHistory: boolean;
  hasMoreHistory: boolean;

  // Current conversation
  selectedWorkdir: string;
  chatId: string;
  userId?: string;
  runtimeContext: RuntimeChatContext;
  drafts: Record<string, string>;

  // Streaming
  streaming: Record<string, StreamingState>;

  // Workdir list
  workdirs: WorkdirOption[];

  // Tenant
  tenants: TenantOption[];
  selectedTenant: string;

  // Sessions for current workdir
  sessions: string[];

  // Actions
  setConnected: (v: boolean) => void;
  setWsRef: (ws: WebSocket | null) => void;
  setReconnectTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  upsertMessage: (msg: ChatMessage, streamingKey?: string) => void;
  prependMessages: (msgs: ChatMessage[]) => void;
  setLoadingHistory: (v: boolean) => void;
  setHasMoreHistory: (v: boolean) => void;
  setSelectedWorkdir: (id: string) => void;
  setChatId: (id: string) => void;
  setUserId: (id?: string) => void;
  setRuntimeContext: (patch: RuntimeChatContext) => void;
  clearRuntimeContext: () => void;
  setSessions: (sessions: string[]) => void;
  saveDraft: (key: string, text: string) => void;
  setWorkdirs: (workdirs: WorkdirOption[]) => void;
  setTenants: (tenants: TenantOption[]) => void;
  setSelectedTenant: (id: string) => void;
  resetConversationFor: (workdirId: string) => void;
  syncRouteSelection: (workdirId: string, tenantId?: string) => void;
  clearStreaming: (key: string) => void;
  applyStreamSnapshot: (key: string, snapshot: {
    partialText?: string;
    activeTools?: ToolInfo[];
    todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
    collaborations?: CollaborationEvent[];
    systemStatus?: string | null;
  }) => void;
  handleRunnerState: (key: string, state: 'idle' | 'running') => void;
  handleStreamEvent: (workdirId: string, chatId: string, event: StreamEvent) => void;
  resetConversation: () => void;
}

function getInitialChatId(): string {
  try {
    const stored = sessionStorage.getItem('hc-chatId');
    if (stored) return stored;
  } catch { /* sessionStorage unavailable */ }
  return `web-${Date.now()}`;
}

function getInitialTenant(): string {
  try {
    return localStorage.getItem('hc-selectedTenant') || '';
  } catch {
    return '';
  }
}

function compactRuntimeContext(context: RuntimeChatContext): RuntimeChatContext {
  const next: RuntimeChatContext = {};
  if (context.tenant) next.tenant = context.tenant;
  if (context.entryId) next.entryId = context.entryId;
  if (context.actorId) next.actorId = context.actorId;
  if (context.targetEmployeeId) next.targetEmployeeId = context.targetEmployeeId;
  if (context.sessionId) next.sessionId = context.sessionId;
  if (context.chatId) next.chatId = context.chatId;
  return next;
}

function getInitialRuntimeContext(): RuntimeChatContext {
  try {
    const stored = sessionStorage.getItem('hc-runtimeContext');
    if (!stored) return {};
    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return compactRuntimeContext({
      tenant: typeof record.tenant === 'string' ? record.tenant : undefined,
      entryId: typeof record.entryId === 'string' ? record.entryId : undefined,
      actorId: typeof record.actorId === 'string' ? record.actorId : undefined,
      targetEmployeeId: typeof record.targetEmployeeId === 'string' ? record.targetEmployeeId : undefined,
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
      chatId: typeof record.chatId === 'string' ? record.chatId : undefined,
    });
  } catch {
    return {};
  }
}

function createChatId(workdirId: string): string {
  return `${workdirId}-${Date.now()}`;
}

function mergeMessagesById(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.timestamp === b.timestamp) return a.id.localeCompare(b.id);
    return a.timestamp - b.timestamp;
  });
}

function persistChatId(chatId: string): void {
  try { sessionStorage.setItem('hc-chatId', chatId); } catch { /* unavailable */ }
}

function persistRuntimeContext(context: RuntimeChatContext): void {
  try {
    const compacted = compactRuntimeContext(context);
    if (Object.keys(compacted).length === 0) {
      sessionStorage.removeItem('hc-runtimeContext');
      return;
    }
    sessionStorage.setItem('hc-runtimeContext', JSON.stringify(compacted));
  } catch { /* unavailable */ }
}

function pickWorkdir(
  workdirs: WorkdirOption[],
  currentId: string,
  selectedTenant: string,
): string {
  if (!selectedTenant && workdirs.some((w) => w.id === currentId)) return currentId;
  if (
    selectedTenant &&
    workdirs.some((w) => w.id === currentId && (w.tenant === selectedTenant || (!w.tenant && selectedTenant === '__none__')))
  ) {
    return currentId;
  }
  const tenantMatch = selectedTenant
    ? workdirs.find((w) => w.tenant === selectedTenant || (!w.tenant && selectedTenant === '__none__'))
    : undefined;
  return tenantMatch?.id || workdirs[0]?.id || 'web';
}

export const useChatStore = create<ChatState>((set, get) => ({
  connected: false,
  wsRef: { current: null } as unknown as React.RefObject<WebSocket | null>,
  reconnectTimer: null,

  messages: [],
  loadingHistory: false,
  hasMoreHistory: false,

  selectedWorkdir: 'web',
  chatId: getInitialChatId(),
  userId: undefined,
  runtimeContext: getInitialRuntimeContext(),
  drafts: {},

  streaming: {},
  workdirs: [],
  tenants: [],
  selectedTenant: getInitialTenant(),
  sessions: [],

  setConnected: (v) => set({ connected: v }),
  setWsRef: (ws) => set({ wsRef: { current: ws } as unknown as React.RefObject<WebSocket | null> }),
  setReconnectTimer: (timer) => set({ reconnectTimer: timer }),

  setMessages: (msgs) => set({ messages: msgs }),

  addMessage: (msg) =>
    set((s) => ({
      messages: [...s.messages, msg],
    })),

  upsertMessage: (msg, streamingKey) =>
    set((s) => {
      const stream = streamingKey ? s.streaming[streamingKey] : undefined;
      const mergedMessage = msg.source === 'bot' && stream?.collaborations?.length
        ? {
            ...msg,
            observability: {
              ...(msg.observability ?? {
                summary: { status: 'completed' as const },
                toolCalls: [],
                handoffs: [],
                startedAt: msg.timestamp,
                finishedAt: msg.timestamp,
              }),
              handoffs: stream.collaborations.map((item) => ({
                from: item.from,
                to: item.to,
                reason: item.reason,
                status: item.status,
                result: item.result,
                contractId: item.contractId,
                parentContractId: item.parentContractId,
              })),
            },
          }
        : msg;
      const messages = mergeMessagesById([...s.messages, mergedMessage]);
      const nextStreaming = { ...s.streaming };
      if (mergedMessage.source === 'bot' && streamingKey) {
        delete nextStreaming[streamingKey];
      }
      return {
        messages,
        streaming: nextStreaming,
      };
    }),

  prependMessages: (msgs) =>
    set((s) => ({
      messages: mergeMessagesById([...msgs, ...s.messages]),
    })),

  setLoadingHistory: (v) => set({ loadingHistory: v }),
  setHasMoreHistory: (v) => set({ hasMoreHistory: v }),

  setSelectedWorkdir: (id) => set({ selectedWorkdir: id }),

  setChatId: (id) => {
    persistChatId(id);
    set({ chatId: id });
  },
  setUserId: (id) => set({ userId: id }),
  setRuntimeContext: (patch) =>
    set((s) => {
      const runtimeContext = compactRuntimeContext({ ...s.runtimeContext, ...patch });
      persistRuntimeContext(runtimeContext);
      return { runtimeContext };
    }),
  clearRuntimeContext: () => {
    persistRuntimeContext({});
    set({ runtimeContext: {} });
  },
  setSessions: (sessions) => set({ sessions }),

  saveDraft: (key, text) =>
    set((s) => ({
      drafts: { ...s.drafts, [key]: text },
    })),

  setWorkdirs: (workdirs) =>
    set((s) => {
      const nextSelected = pickWorkdir(workdirs, s.selectedWorkdir, s.selectedTenant);
      if (nextSelected === s.selectedWorkdir) {
        return { workdirs };
      }

      const nextChatId = createChatId(nextSelected);
      persistChatId(nextChatId);
      return {
        workdirs,
        selectedWorkdir: nextSelected,
        messages: [],
        chatId: nextChatId,
        userId: undefined,
        streaming: {},
      };
    }),

  setTenants: (tenants) =>
    set((s) => {
      const defaultTenant = tenants.find((tenant) => tenant.id === 'acme-happycompany')?.id || tenants[0]?.id || '';
      const isStaleLegacyAcme =
        s.selectedTenant === 'acme' &&
        defaultTenant === 'acme-happycompany';
      const preserved = tenants.some((tenant) => tenant.id === s.selectedTenant) && !isStaleLegacyAcme
        ? s.selectedTenant
        : defaultTenant;
      if (preserved) {
        try { localStorage.setItem('hc-selectedTenant', preserved); } catch { /* unavailable */ }
      }
      if (preserved !== s.selectedTenant) {
        persistRuntimeContext({});
      }
      return {
        tenants,
        selectedTenant: preserved,
        runtimeContext: preserved === s.selectedTenant ? s.runtimeContext : {},
      };
    }),

  setSelectedTenant: (id) =>
    set((s) => {
      try { localStorage.setItem('hc-selectedTenant', id); } catch { /* unavailable */ }
      const tenantWorkdirs = s.workdirs.filter(
        (w) => !id || w.tenant === id || (!w.tenant && id === '__none__'),
      );
      const preserveCurrent =
        tenantWorkdirs.some((w) => w.id === s.selectedWorkdir) ||
        (!tenantWorkdirs.some((w) => w.id === s.selectedWorkdir) &&
          s.selectedWorkdir === id &&
          s.workdirs.some((w) => w.id === s.selectedWorkdir));
      return {
        selectedTenant: id,
        selectedWorkdir: preserveCurrent
          ? s.selectedWorkdir
          : tenantWorkdirs[0]?.id || s.workdirs[0]?.id || 'web',
      };
    }),

  resetConversationFor: (workdirId) =>
    set(() => {
      const newId = createChatId(workdirId);
      persistChatId(newId);
      return {
        selectedWorkdir: workdirId,
        messages: [],
        chatId: newId,
        userId: undefined,
        runtimeContext: {},
        streaming: {},
      };
    }),

  syncRouteSelection: (workdirId, tenantId) =>
    set((s) => {
      const nextTenant = tenantId || s.selectedTenant;
      const currentChatMatches = s.chatId.startsWith(`${workdirId}-`);
      const tenantUnchanged = nextTenant === s.selectedTenant;
      const workdirUnchanged = s.selectedWorkdir === workdirId;

      if (tenantUnchanged && workdirUnchanged && currentChatMatches) {
        return s;
      }

      const nextState: Partial<ChatState> = {
        selectedWorkdir: workdirId,
      };

      if (tenantId && tenantId !== s.selectedTenant) {
        nextState.selectedTenant = tenantId;
      }

      if (!currentChatMatches) {
        const newId = createChatId(workdirId);
        persistChatId(newId);
        nextState.chatId = newId;
        nextState.messages = [];
        nextState.userId = undefined;
        nextState.streaming = {};
      }

      return nextState as ChatState;
    }),

  clearStreaming: (key) =>
    set((s) => {
      const next = { ...s.streaming };
      delete next[key];
      return { streaming: next };
    }),

  applyStreamSnapshot: (key, snapshot) =>
    set((s) => ({
      streaming: {
        ...s.streaming,
        [key]: {
          ...(s.streaming[key] ?? defaultStreaming()),
          isStreaming: true,
          partialText: snapshot.partialText ?? '',
          activeTools: snapshot.activeTools ?? [],
          todos: snapshot.todos ?? [],
          collaborations: snapshot.collaborations ?? [],
          systemStatus: snapshot.systemStatus ?? undefined,
          interrupted: false,
        },
      },
    })),

  handleRunnerState: (key, state) =>
    set((s) => {
      const next = { ...s.streaming };
      if (state === 'idle') {
        delete next[key];
        return { streaming: next };
      }
      next[key] = {
        ...(next[key] ?? defaultStreaming()),
        isStreaming: true,
        interrupted: false,
      };
      return { streaming: next };
    }),

  handleStreamEvent: (workdirId, chatId, event) => {
    const key = `${workdirId}:${chatId}`;
    const s = get();

    switch (event.eventType) {
      case 'text_delta':
        if (event.text) {
          const prev = s.streaming[key];
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                partialText: (prev?.partialText ?? '') + event.text,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'thinking_delta':
        if (event.text) {
          const prev = s.streaming[key];
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                thinkingText: (prev?.thinkingText ?? '') + event.text,
                isThinking: true,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'tool_use_start':
        if (event.toolName && event.toolUseId) {
          const prev = s.streaming[key];
          const tool: ToolInfo = {
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            startTime: Date.now(),
            elapsedSeconds: event.elapsedSeconds,
            parentToolUseId: event.parentToolUseId,
            isNested: event.isNested,
            skillName: event.skillName,
            toolInputSummary: event.toolInputSummary,
            toolInput: event.toolInput as Record<string, unknown>,
          };
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                activeTools: [...(prev?.activeTools ?? []), tool],
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'tool_use_end':
        if (event.toolUseId) {
          const prev = s.streaming[key];
          const tools = (prev?.activeTools ?? []).filter((t) => t.toolUseId !== event.toolUseId);
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                activeTools: tools,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'todo_update':
        if (event.todos) {
          const prev = s.streaming[key];
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                todos: event.todos,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'handoff':
        if (event.handoffFrom && event.handoffTo) {
          const prev = s.streaming[key];
          const collaboration: CollaborationEvent = {
            from: event.handoffFrom,
            to: event.handoffTo,
            reason: event.handoffReason,
            status: 'pending',
            contractId: event.contractId,
            parentContractId: event.parentContractId,
            timestamp: Date.now(),
          };
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                collaborations: [...(prev?.collaborations ?? []), collaboration],
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'handoff_result':
        if (event.handoffTo && event.handoffStatus) {
          const prev = s.streaming[key];
          const existing = prev?.collaborations ?? [];
          const now = Date.now();
          let matchIndex = -1;
          for (let index = existing.length - 1; index >= 0; index -= 1) {
            const item = existing[index];
            if (item.to === event.handoffTo && (!event.contractId || item.contractId === event.contractId || !item.contractId)) {
              matchIndex = index;
              break;
            }
          }
          const updated: CollaborationEvent = {
            ...(matchIndex >= 0
              ? existing[matchIndex]
              : {
                  from: event.handoffFrom ?? 'delegated',
                  to: event.handoffTo,
                  timestamp: now,
                  status: 'pending' as const,
                }),
            status: event.handoffStatus,
            result: event.handoffResult,
            contractId: event.contractId,
            parentContractId: event.parentContractId,
            completedAt: now,
          };
          const collaborations = matchIndex >= 0
            ? existing.map((item, index) => (index === matchIndex ? updated : item))
            : [...existing, updated];
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                collaborations,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'status':
        if (event.statusText) {
          const prev = s.streaming[key];
          if (event.statusText === 'interrupted') {
            set({
              streaming: {
                ...s.streaming,
                [key]: {
                  ...(prev ?? defaultStreaming()),
                  isStreaming: false,
                  isThinking: false,
                  activeTools: [],
                  systemStatus: undefined,
                  interrupted: true,
                },
              },
            });
            break;
          }
          set({
            streaming: {
              ...s.streaming,
              [key]: {
                ...(prev ?? defaultStreaming()),
                isStreaming: true,
                systemStatus: event.statusText,
                interrupted: false,
              },
            },
          });
        }
        break;

      case 'init':
      case 'usage':
      default:
        break;
    }
  },

  resetConversation: () =>
    set((s) => {
      const newId = createChatId(s.selectedWorkdir);
      persistChatId(newId);
      persistRuntimeContext({});
      return {
        messages: [],
        chatId: newId,
        userId: undefined,
        runtimeContext: {},
        streaming: {},
      };
    }),
}));

function defaultStreaming(): StreamingState {
  return {
    isStreaming: false,
    partialText: '',
    thinkingText: '',
    isThinking: false,
    thinkingDurationMs: 0,
    activeTools: [],
    recentEvents: [],
    collaborations: [],
    todos: [],
    interrupted: false,
  };
}
