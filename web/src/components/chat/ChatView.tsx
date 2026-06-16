import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { toast } from 'sonner';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { Bot, History, MessageSquarePlus, PlugZap, RefreshCw, UserRound, UsersRound, type LucideIcon } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import type { AgentObservability, ChatMessage, CollaborationEvent, RuntimeChatContext, ToolInfo } from '../../stores/chat';
import type { StreamEvent } from '../../types/stream-event';
import {
  api,
  type RuntimeActor,
  type RuntimeEntry,
  type RuntimeSessionInfo,
  type RuntimeTarget,
  type WebChatConfig,
} from '../../lib/api';

interface ChatViewProps {
  selectedWorkdir: string;
  workdirs: Array<{ id: string; displayName: string; path?: string; channels?: string[]; status?: string; tenant?: string }>;
  initialRuntimeContext?: RuntimeChatContext;
  onWorkdirChange: (id: string) => void;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_WEB_CHAT_CONFIG: WebChatConfig = {
  welcomeTitle: '你好，有什么可以帮你？',
  welcomeSubtitle: '选择下方话题快速开始，或直接输入你的问题。',
  inputPlaceholder: '输入消息... (Enter 发送)',
  historyLimit: 50,
  enableImageUpload: true,
  showSessionPicker: true,
  showQuickPrompts: true,
};

const selectStyle: CSSProperties = {
  border: '0',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
  minWidth: '0',
};

interface SelectFieldProps {
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  maxWidth?: string;
}

function SelectField({ label, icon: Icon, value, onChange, children, maxWidth = '220px' }: SelectFieldProps) {
  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 min-w-0 flex-shrink-0"
      style={{
        border: '1px solid var(--color-border-soft)',
        background: 'var(--color-bg-input)',
        minWidth: '132px',
        maxWidth,
      }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
      <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs cursor-pointer focus:outline-none min-w-0 flex-1"
        style={selectStyle}
      >
        {children}
      </select>
    </label>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isImageAttachment(value: unknown): value is { type: string; data: string; mimeType: string } {
  if (!isRecord(value)) return false;
  return readString(value.type) !== undefined
    && readString(value.data) !== undefined
    && readString(value.mimeType) !== undefined;
}

function isStreamEvent(value: unknown): value is StreamEvent {
  return isRecord(value) && typeof value.eventType === 'string';
}

function parseObservability(value: unknown): AgentObservability | undefined {
  const raw = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return undefined;
        }
      })()
    : value;
  if (!isRecord(raw) || !isRecord(raw.summary)) return undefined;
  const summaryStatus = readString(raw.summary.status);
  if (summaryStatus !== 'completed' && summaryStatus !== 'failed' && summaryStatus !== 'interrupted') return undefined;
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  const init = isRecord(raw.init) ? raw.init : undefined;
  return {
    summary: {
      status: summaryStatus,
      stopReason: readString(raw.summary.stopReason) ?? null,
      errors: Array.isArray(raw.summary.errors) ? raw.summary.errors.filter((item): item is string => typeof item === 'string') : undefined,
      permissionDenials: Array.isArray(raw.summary.permissionDenials)
        ? raw.summary.permissionDenials.filter((item): item is { toolName: string; toolUseId: string } => (
            isRecord(item) && typeof item.toolName === 'string' && typeof item.toolUseId === 'string'
          ))
        : undefined,
    },
    init: init
      ? {
          sessionId: readString(init.sessionId) ?? '',
          model: readString(init.model) ?? '',
          cwd: readString(init.cwd) ?? '',
          tools: Array.isArray(init.tools) ? init.tools.filter((item): item is string => typeof item === 'string') : [],
          mcpServers: Array.isArray(init.mcpServers)
            ? init.mcpServers.filter((item): item is { name: string; status: string } => (
                isRecord(item) && typeof item.name === 'string' && typeof item.status === 'string'
              ))
            : [],
          skills: Array.isArray(init.skills) ? init.skills.filter((item): item is string => typeof item === 'string') : [],
          plugins: Array.isArray(init.plugins)
            ? init.plugins.filter((item): item is { name: string; path: string } => (
                isRecord(item) && typeof item.name === 'string' && typeof item.path === 'string'
              ))
            : [],
          permissionMode: readString(init.permissionMode) ?? '',
          claudeCodeVersion: readString(init.claudeCodeVersion) ?? '',
        }
      : undefined,
    usage: usage
      ? {
          inputTokens: toNumber(usage.inputTokens),
          outputTokens: toNumber(usage.outputTokens),
          cacheReadInputTokens: toNumber(usage.cacheReadInputTokens),
          cacheCreationInputTokens: toNumber(usage.cacheCreationInputTokens),
          costUSD: toNumber(usage.costUSD),
          durationMs: toNumber(usage.durationMs),
          apiDurationMs: typeof usage.apiDurationMs === 'number' ? usage.apiDurationMs : undefined,
          numTurns: toNumber(usage.numTurns),
        }
      : undefined,
    toolCalls: Array.isArray(raw.toolCalls)
      ? raw.toolCalls.filter((item): item is AgentObservability['toolCalls'][number] => (
          isRecord(item)
          && typeof item.toolName === 'string'
          && typeof item.toolUseId === 'string'
          && (item.status === 'running' || item.status === 'completed')
        ))
      : [],
    handoffs: Array.isArray(raw.handoffs)
      ? raw.handoffs.filter((item): item is AgentObservability['handoffs'][number] => (
          isRecord(item) && typeof item.from === 'string' && typeof item.to === 'string'
        ))
      : [],
    startedAt: toNumber(raw.startedAt),
    finishedAt: toNumber(raw.finishedAt),
  };
}

interface RuntimeEventMeta {
  tenant?: string;
  entryId?: string;
  actorId?: string;
  employeeId?: string;
  sessionId?: string;
}

function readRuntimeEventMeta(data: Record<string, unknown>): RuntimeEventMeta {
  const meta = isRecord(data.meta) ? data.meta : {};
  const message = isRecord(data.message) ? data.message : {};
  return {
    tenant: readString(meta.tenant) ?? readString(message.tenant),
    entryId: readString(meta.entryId) ?? readString(message.entryId),
    actorId: readString(meta.actorId) ?? readString(message.actorId),
    employeeId: readString(meta.employeeId) ?? readString(message.employeeId),
    sessionId: readString(meta.sessionId) ?? readString(message.sessionId),
  };
}

function toChatMessage(raw: unknown, fallback: { botName: string; chatId: string }): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const text = readString(raw.text);
  const source = readString(raw.source);
  if (!id || text === undefined || (source !== 'user' && source !== 'bot')) return null;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.filter(isImageAttachment)
    : undefined;
  return {
    id,
    chatId: readString(raw.chatId) ?? fallback.chatId,
    text,
    source,
    botName: readString(raw.botName) ?? fallback.botName,
    timestamp: toTimestamp(raw.timestamp),
    attachments,
    observability: parseObservability(raw.observability),
  };
}

function runtimeContextKey(context?: RuntimeChatContext): string {
  if (!context) return '';
  return [
    context.tenant,
    context.entryId,
    context.actorId,
    context.targetEmployeeId,
    context.sessionId,
    context.chatId,
  ].filter(Boolean).join('|');
}

export function ChatView({ selectedWorkdir, workdirs, initialRuntimeContext, onWorkdirChange }: ChatViewProps) {
  const {
    connected,
    setConnected,
    setWsRef,
    setMessages,
    prependMessages,
    upsertMessage,
    messages,
    drafts,
    streaming,
    selectedWorkdir: storeWorkdir,
    selectedTenant,
    chatId,
    setChatId,
    userId,
    setUserId,
    runtimeContext,
    setRuntimeContext,
    sessions,
    setSessions,
    handleStreamEvent,
    handleRunnerState,
    applyStreamSnapshot,
    resetConversation,
    setLoadingHistory,
    setHasMoreHistory,
    loadingHistory,
    hasMoreHistory,
  } = useChatStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const mountedRef = useRef(true);
  const refreshSessionsRef = useRef<() => void>(() => {});
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [webChatConfig, setWebChatConfig] = useState<WebChatConfig>(DEFAULT_WEB_CHAT_CONFIG);

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
  const streamingKey = `${selectedWorkdir}:${chatId}`;
  const isStreaming = streaming[streamingKey]?.isStreaming ?? false;
  const selectedAgentTenant = workdirs.find((w) => w.id === selectedWorkdir)?.tenant ?? selectedTenant;
  const historyLimit = Math.max(10, Math.min(200, webChatConfig.historyLimit || 50));
  const [runtimeEntries, setRuntimeEntries] = useState<RuntimeEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState(() => initialRuntimeContext?.entryId || runtimeContext.entryId || '');
  const [runtimeActors, setRuntimeActors] = useState<RuntimeActor[]>([]);
  const [selectedActorId, setSelectedActorId] = useState(() => initialRuntimeContext?.actorId || runtimeContext.actorId || '');
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);
  const [selectedTargetEmployeeId, setSelectedTargetEmployeeId] = useState(() => (
    initialRuntimeContext?.targetEmployeeId || runtimeContext.targetEmployeeId || ''
  ));
  const [selectedRuntimeSessionId, setSelectedRuntimeSessionId] = useState(() => (
    initialRuntimeContext?.sessionId || runtimeContext.sessionId || ''
  ));
  const appliedInitialContextRef = useRef('');
  const activeBotId = selectedTargetEmployeeId || selectedWorkdir;
  const activeStreamingKey = `${activeBotId}:${chatId}`;
  const activeStreaming = streaming[activeStreamingKey]?.isStreaming ?? isStreaming;
  const runtimeEnabled = Boolean(selectedAgentTenant && selectedEntryId && selectedActorId);
  const selectedWorkdirOption = workdirs.find((w) => w.id === selectedWorkdir);
  const selectedEntry = runtimeEntries.find((entry) => entry.id === selectedEntryId);
  const selectedActor = runtimeActors.find((actor) => actor.actorId === selectedActorId);
  const selectedTarget = runtimeTargets.find((target) => target.employeeId === selectedTargetEmployeeId);
  const activeDisplayName = selectedTarget?.displayName || selectedWorkdirOption?.displayName || selectedTargetEmployeeId || selectedWorkdir;
  const activeContextMeta = runtimeEnabled
    ? [selectedEntry?.displayName || selectedEntryId, selectedActor?.displayName || selectedActorId].filter(Boolean).join(' / ')
    : selectedWorkdirOption?.tenant || selectedAgentTenant || '默认工作区';
  const inputStatusText = connected
    ? `将发送给 ${activeDisplayName}`
    : '连接中断，消息暂不能发送';

  useEffect(() => {
    api.getWebChatConfig()
      .then((cfg) => setWebChatConfig({ ...DEFAULT_WEB_CHAT_CONFIG, ...cfg }))
      .catch(() => setWebChatConfig(DEFAULT_WEB_CHAT_CONFIG));
  }, []);

  useEffect(() => {
    const key = runtimeContextKey(initialRuntimeContext);
    if (!key || key === appliedInitialContextRef.current) return;
    appliedInitialContextRef.current = key;
    if (initialRuntimeContext?.entryId) setSelectedEntryId(initialRuntimeContext.entryId);
    if (initialRuntimeContext?.actorId) setSelectedActorId(initialRuntimeContext.actorId);
    if (initialRuntimeContext?.targetEmployeeId) setSelectedTargetEmployeeId(initialRuntimeContext.targetEmployeeId);
    if (initialRuntimeContext?.sessionId) setSelectedRuntimeSessionId(initialRuntimeContext.sessionId);
    if (initialRuntimeContext?.chatId) setChatId(initialRuntimeContext.chatId);
    setRuntimeContext(initialRuntimeContext ?? {});
    setMessages([]);
  }, [
    initialRuntimeContext,
    setChatId,
    setMessages,
    setRuntimeContext,
  ]);

  useEffect(() => {
    if (!selectedAgentTenant) return;
    api.listRuntimeEntries(selectedAgentTenant)
      .then(({ entries }) => {
        setRuntimeEntries(entries);
        setSelectedEntryId((current) => {
          if (entries.some((entry) => entry.id === current)) return current;
          const preferred = initialRuntimeContext?.entryId || runtimeContext.entryId;
          if (preferred && entries.some((entry) => entry.id === preferred)) return preferred;
          return entries.find((entry) => entry.channel === 'web')?.id || entries[0]?.id || '';
        });
      })
      .catch(() => {
        setRuntimeEntries([]);
        setSelectedEntryId('');
      });
  }, [selectedAgentTenant]);

  useEffect(() => {
    if (!selectedAgentTenant || !selectedEntryId) {
      setRuntimeActors([]);
      setSelectedActorId('');
      return;
    }
    api.listRuntimeActors(selectedAgentTenant, selectedEntryId)
      .then(({ actors }) => {
        setRuntimeActors(actors);
        setSelectedActorId((current) => {
          if (actors.some((actor) => actor.actorId === current)) return current;
          const preferred = initialRuntimeContext?.actorId || runtimeContext.actorId;
          if (preferred && actors.some((actor) => actor.actorId === preferred)) return preferred;
          return actors[0]?.actorId || '';
        });
      })
      .catch(() => {
        setRuntimeActors([]);
        setSelectedActorId('');
      });
  }, [selectedAgentTenant, selectedEntryId]);

  useEffect(() => {
    if (!selectedAgentTenant || !selectedEntryId || !selectedActorId) {
      setRuntimeTargets([]);
      setSelectedTargetEmployeeId('');
      return;
    }
    api.listRuntimeTargets(selectedAgentTenant, selectedActorId, selectedEntryId)
      .then(({ targets }) => {
        setRuntimeTargets(targets);
        setSelectedTargetEmployeeId((current) => {
          if (targets.some((target) => target.employeeId === current)) return current;
          const preferred = initialRuntimeContext?.targetEmployeeId || runtimeContext.targetEmployeeId;
          if (preferred && targets.some((target) => target.employeeId === preferred)) return preferred;
          return targets.find((target) => target.isDefault)?.employeeId || targets[0]?.employeeId || '';
        });
      })
      .catch(() => {
        setRuntimeTargets([]);
        setSelectedTargetEmployeeId('');
      });
  }, [selectedAgentTenant, selectedEntryId, selectedActorId]);

  // Connect WebSocket
  const connectWs = useCallback(() => {
    if (!wsUrl || !mountedRef.current) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setWsRef(ws);

    ws.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = 1000;
    };

    ws.onmessage = (e) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(e.data as string);
      } catch {
        return;
      }

      const runtimeMeta = readRuntimeEventMeta(data);
      const workdirId = readString(data.workdirId) ?? readString(data.botName) ?? runtimeMeta.employeeId ?? activeBotId;
      const cid = readString(data.chatId) ?? chatId;
      const eventBotId = runtimeMeta.employeeId ?? workdirId;
      const key = `${eventBotId}:${cid}`;
      const currentIds = new Set([selectedWorkdir, activeBotId, selectedTargetEmployeeId].filter(Boolean));
      const isLegacyCurrentChat = currentIds.has(workdirId);
      const isRuntimeCurrentChat = runtimeEnabled
        && runtimeMeta.tenant === selectedAgentTenant
        && runtimeMeta.entryId === selectedEntryId
        && runtimeMeta.actorId === selectedActorId
        && (!selectedTargetEmployeeId || runtimeMeta.employeeId === selectedTargetEmployeeId);
      const isCurrentChat = cid === chatId && (isLegacyCurrentChat || isRuntimeCurrentChat);

      if (isRuntimeCurrentChat && !selectedTargetEmployeeId && runtimeMeta.employeeId) {
        setSelectedTargetEmployeeId(runtimeMeta.employeeId);
      }

      if (data.type === 'new_message') {
        if (!isCurrentChat) return;
        const message = toChatMessage(data.message, { botName: eventBotId, chatId: cid });
        if (!message) return;
        upsertMessage(message, key);
        if (message.source === 'bot') {
          setTimeout(() => refreshSessionsRef.current(), 500);
        }
      } else if (data.type === 'stream_event') {
        if (!isCurrentChat || !isStreamEvent(data.event)) return;
        handleStreamEvent(eventBotId, cid, data.event);
      } else if (data.type === 'stream_snapshot') {
        if (!isCurrentChat || !isRecord(data.snapshot)) return;
        const snap = data.snapshot;
        applyStreamSnapshot(key, {
          partialText: readString(snap.partialText),
          activeTools: Array.isArray(snap.activeTools) ? (snap.activeTools as ToolInfo[]) : undefined,
          todos: Array.isArray(snap.todos)
            ? (snap.todos as Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>)
            : undefined,
          collaborations: Array.isArray(snap.collaborations)
            ? (snap.collaborations as CollaborationEvent[])
            : undefined,
          systemStatus: readString(snap.systemStatus) ?? null,
        });
      } else if (data.type === 'runner_state') {
        if (!isCurrentChat) return;
        const state = readString(data.state);
        if (state === 'idle' || state === 'running') {
          handleRunnerState(key, state);
        }
      } else if (data.type === 'ws_error') {
        toast.error(readString(data.error) ?? 'WebSocket error');
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (mountedRef.current) {
        const delay = reconnectDelayRef.current;
        reconnectTimerRef.current = setTimeout(connectWs, delay);
        reconnectDelayRef.current = Math.min(delay * 1.5, MAX_RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => ws.close();
  }, [wsUrl, selectedWorkdir, activeBotId, selectedTargetEmployeeId, chatId, runtimeEnabled, selectedAgentTenant, selectedEntryId, selectedActorId, setConnected, setWsRef, handleStreamEvent, handleRunnerState, applyStreamSnapshot, upsertMessage]);

  const disconnectWs = useCallback(() => {
    mountedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();
    return disconnectWs;
  }, [connectWs, disconnectWs]);

  const [sessionInfos, setSessionInfos] = useState<RuntimeSessionInfo[]>([]);

  // Fetch sessions when runtime identity changes
  const refreshSessions = useCallback(() => {
    if (runtimeEnabled) {
      api.listRuntimeSessions({
        tenant: selectedAgentTenant,
        entryId: selectedEntryId,
        actorId: selectedActorId,
        employeeId: selectedTargetEmployeeId || undefined,
        limit: 100,
      })
        .then(({ sessions: list }) => {
          setSessionInfos(list);
          setSessions(list.map((s) => s.id));
        })
        .catch(() => {
          setSessionInfos([]);
          setSessions([]);
        });
      return;
    }
    if (!selectedWorkdir) return;
    fetch(`/api/workdir/${encodeURIComponent(selectedWorkdir)}/sessions`)
      .then((res) => res.json())
      .then((json) => {
        const legacy = (json.sessions ?? []) as Array<{ chatId: string; messageCount: number; lastMessageAt: number; preview: string }>;
        const list: RuntimeSessionInfo[] = legacy.map((s) => ({
          id: s.chatId,
          tenant: selectedAgentTenant || '',
          entryId: selectedWorkdir,
          channel: 'web',
          actorId: '',
          chatId: s.chatId,
          employeeId: selectedWorkdir,
          instanceId: selectedWorkdir,
          workdir: '',
          sdkSessionScope: s.chatId,
          mode: 'single_employee',
          messageCount: s.messageCount,
          lastMessageAt: s.lastMessageAt,
          preview: s.preview,
        }));
        setSessionInfos(list);
        setSessions(list.map((s) => s.id));
      })
      .catch(() => {
        setSessionInfos([]);
        setSessions([]);
      });
  }, [runtimeEnabled, selectedAgentTenant, selectedEntryId, selectedActorId, selectedTargetEmployeeId, selectedWorkdir, setSessions]);

  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
  });

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!runtimeEnabled) return;
    setRuntimeContext({
      tenant: selectedAgentTenant,
      entryId: selectedEntryId,
      actorId: selectedActorId,
      targetEmployeeId: selectedTargetEmployeeId || undefined,
      sessionId: selectedRuntimeSessionId || undefined,
      chatId,
    });
  }, [
    runtimeEnabled,
    selectedAgentTenant,
    selectedEntryId,
    selectedActorId,
    selectedTargetEmployeeId,
    selectedRuntimeSessionId,
    chatId,
    setRuntimeContext,
  ]);

  useEffect(() => {
    if (!selectedRuntimeSessionId) return;
    const runtimeSession = sessionInfos.find((session) => session.id === selectedRuntimeSessionId);
    if (!runtimeSession) return;
    if (runtimeSession.employeeId && runtimeSession.employeeId !== selectedTargetEmployeeId) {
      setSelectedTargetEmployeeId(runtimeSession.employeeId);
    }
    if (runtimeSession.chatId !== chatId) {
      setChatId(runtimeSession.chatId);
    }
  }, [selectedRuntimeSessionId, sessionInfos, selectedTargetEmployeeId, chatId, setChatId]);

  // Load history when chatId changes
  useEffect(() => {
    if (!selectedWorkdir || !chatId) return;
    if (runtimeEnabled && !selectedRuntimeSessionId) {
      setMessages([]);
      setHasMoreHistory(false);
      return;
    }
    setLoadingHistory(true);
    const load = runtimeEnabled
      ? api.getRuntimeSessionMessages(selectedRuntimeSessionId, historyLimit).then(({ messages }) => ({
          data: messages.map((m) => ({
            id: m.id,
            chat_id: m.chatId,
            text: m.text,
            source: m.source,
            bot_name: m.botName ?? null,
            timestamp: m.timestamp,
            attachments: undefined,
            observability: m.observability,
          })),
        }))
      : fetch(
          `/api/chat/${encodeURIComponent(selectedWorkdir)}/history?chatId=${encodeURIComponent(chatId)}&limit=${historyLimit}`,
        ).then((res) => res.json());
    load.then((json) => {
        const history = (json.data ?? []) as Array<{
          id: string;
          chat_id: string;
          text: string;
          source: string;
          bot_name: string | null;
          timestamp: number;
          attachments?: string;
          observability?: unknown;
        }>;
        if (history.length > 0) {
          setMessages(
            history.map((m) => ({
              id: m.id,
              chatId: m.chat_id,
              text: m.text,
              source: m.source === 'user' ? 'user' as const : 'bot' as const,
              botName: m.bot_name ?? undefined,
              timestamp: m.timestamp,
              attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
              observability: parseObservability(m.observability),
            })),
          );
          setHasMoreHistory(history.length >= historyLimit);
        }
      })
      .catch(() => toast.error('加载历史记录失败'))
      .finally(() => setLoadingHistory(false));
  }, [selectedWorkdir, chatId, runtimeEnabled, selectedRuntimeSessionId, historyLimit, setMessages, setHasMoreHistory, setLoadingHistory]);

  // Keep chatId in sync with store
  useEffect(() => {
    const storeChatId = useChatStore.getState().chatId;
    if (storeChatId !== chatId) {
      // External update
    }
  }, [chatId]);

  const handleSend = async (content: string, attachments?: Array<{ data: string; mimeType: string }>): Promise<boolean> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error('未连接到服务器');
      return false;
    }

    try {
      const payload: Record<string, unknown> = {
        type: 'send_message',
        chatId,
        content,
        attachments,
      };
      if (runtimeEnabled) {
        payload.tenant = selectedAgentTenant;
        payload.entryId = selectedEntryId;
        payload.actorId = selectedActorId;
        if (selectedTargetEmployeeId) {
          payload.target = { employeeId: selectedTargetEmployeeId };
        }
      } else {
        payload.workdirId = selectedWorkdir;
        payload.tenant = selectedAgentTenant;
      }
      if (userId && !runtimeEnabled) {
        payload.userId = userId;
      }
      ws.send(JSON.stringify(payload));
      setScrollTrigger((n) => n + 1);
      return true;
    } catch {
      toast.error('发送失败');
      return false;
    }
  };

  const handleAbort = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'chat_abort', workdirId: activeBotId, tenant: selectedAgentTenant, chatId }));
  }, [activeBotId, selectedAgentTenant, chatId]);

  const handleNewChat = useCallback(() => {
    if (runtimeEnabled) {
      setSelectedRuntimeSessionId('');
      setChatId(`${selectedEntryId || selectedWorkdir}-${Date.now()}`);
      setMessages([]);
    } else {
      resetConversation();
    }
    setScrollTrigger((n) => n + 1);
    // Re-fetch sessions after a brief delay to let new state settle
    setTimeout(refreshSessions, 300);
  }, [runtimeEnabled, selectedEntryId, selectedWorkdir, setChatId, setMessages, resetConversation, refreshSessions]);

  const handleSessionSelect = useCallback((sessionKey: string) => {
    if (!sessionKey) {
      // New anonymous session
      setSelectedRuntimeSessionId('');
      setUserId(undefined);
      setChatId(`${runtimeEnabled ? selectedEntryId || selectedWorkdir : selectedWorkdir}-${Date.now()}`);
      setMessages([]);
      setScrollTrigger((n) => n + 1);
      return;
    }
    const runtimeSession = sessionInfos.find((session) => session.id === sessionKey);
    if (runtimeSession) {
      setSelectedRuntimeSessionId(runtimeSession.id);
      setUserId(undefined);
      if (runtimeSession.employeeId) setSelectedTargetEmployeeId(runtimeSession.employeeId);
      setChatId(runtimeSession.chatId);
      setMessages([]);
      setScrollTrigger((n) => n + 1);
      return;
    }
    // Parse sessionKey: either "chatId" or "userId:chatId"
    const colonIdx = sessionKey.indexOf(':');
    if (colonIdx > 0) {
      const uid = sessionKey.slice(0, colonIdx);
      const cid = sessionKey.slice(colonIdx + 1);
      setUserId(uid);
      setChatId(cid);
    } else {
      setUserId(undefined);
      setChatId(sessionKey);
    }
    setMessages([]);
    setScrollTrigger((n) => n + 1);
  }, [runtimeEnabled, selectedEntryId, selectedWorkdir, sessionInfos, setUserId, setChatId, setMessages]);

  const handleLoadMore = useCallback(() => {
    if (!selectedWorkdir || !chatId || loadingHistory || messages.length === 0) return;
    if (runtimeEnabled) {
      setHasMoreHistory(false);
      return;
    }
    const earliestTimestamp = messages[0].timestamp;
    setLoadingHistory(true);
    fetch(
      `/api/chat/${encodeURIComponent(selectedWorkdir)}/history?chatId=${encodeURIComponent(chatId)}&before=${earliestTimestamp}&limit=${historyLimit}`,
    )
      .then((res) => res.json())
      .then((json) => {
        const older = (json.data ?? []) as Array<{
          id: string;
          chat_id: string;
          text: string;
          source: string;
          bot_name: string | null;
          timestamp: number;
          attachments?: string;
          observability?: unknown;
        }>;
        if (older.length > 0) {
          prependMessages(
            older.map((m) => ({
              id: m.id,
              chatId: m.chat_id,
              text: m.text,
              source: m.source === 'user' ? 'user' as const : 'bot' as const,
              botName: m.bot_name ?? undefined,
              timestamp: m.timestamp,
              attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
              observability: parseObservability(m.observability),
            })),
          );
          setHasMoreHistory(older.length >= historyLimit);
        } else {
          setHasMoreHistory(false);
        }
      })
      .catch(() => toast.error('加载更多消息失败'))
      .finally(() => setLoadingHistory(false));
  }, [selectedWorkdir, chatId, runtimeEnabled, loadingHistory, messages, historyLimit, prependMessages, setLoadingHistory, setHasMoreHistory]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-deep)' }}>
      {/* Header */}
      <div
        className="flex flex-col gap-2 px-4 py-3 flex-shrink-0 min-w-0"
        style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}
      >
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent)' }}
              >
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {activeDisplayName}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {activeContextMeta}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
              style={{
                border: '1px solid var(--color-border-soft)',
                background: connected ? 'var(--color-success-dim)' : 'var(--color-bg-input)',
                color: connected ? 'var(--color-success)' : 'var(--color-text-muted)',
              }}
            >
              <PlugZap className="w-3.5 h-3.5" />
              {connected ? '已连接' : '已断开'}
            </span>
            {!connected && (
              <button
                type="button"
                onClick={() => {
                  reconnectDelayRef.current = 1000;
                  if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                  connectWs();
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
                style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border-soft)', background: 'var(--color-bg-input)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}
                title="重连"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-0 overflow-x-auto pb-0.5">
          {runtimeEntries.length > 0 ? (
            <>
              <SelectField label="入口" icon={PlugZap} value={selectedEntryId} onChange={setSelectedEntryId}>
                {runtimeEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.displayName || entry.id}</option>
                ))}
              </SelectField>
              <SelectField
                label="发起人"
                icon={UserRound}
                value={selectedActorId}
                onChange={(value) => {
                  setSelectedActorId(value);
                  setSelectedRuntimeSessionId('');
                  setMessages([]);
                }}
              >
                {runtimeActors.length === 0 && <option value="">未绑定人员</option>}
                {runtimeActors.map((actor) => (
                  <option key={actor.actorId} value={actor.actorId}>{actor.displayName || actor.actorId}</option>
                ))}
              </SelectField>
              <SelectField
                label="员工"
                icon={UsersRound}
                value={selectedTargetEmployeeId}
                onChange={(value) => {
                  setSelectedTargetEmployeeId(value);
                  setSelectedRuntimeSessionId('');
                  setMessages([]);
                }}
              >
                {runtimeTargets.length === 0 && <option value="">未绑定员工</option>}
                {runtimeTargets.map((target) => (
                  <option key={target.employeeId} value={target.employeeId}>{target.displayName || target.employeeId}</option>
                ))}
              </SelectField>
            </>
          ) : (
            <SelectField label="工作区" icon={Bot} value={selectedWorkdir} onChange={onWorkdirChange}>
              {workdirs.map((workdir) => (
                <option key={workdir.id} value={workdir.id}>{workdir.displayName || workdir.id}</option>
              ))}
            </SelectField>
          )}
          {webChatConfig.showSessionPicker && sessionInfos.length > 0 && (
            <SelectField label="会话" icon={History} value={selectedRuntimeSessionId || chatId} onChange={handleSessionSelect} maxWidth="320px">
              <option value="">+ 新会话</option>
              {sessionInfos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.preview
                    ? `${s.preview.slice(0, 40)}${s.preview.length > 40 ? '…' : ''}`
                    : `会话 ${s.chatId.slice(-8)}`}
                  {s.messageCount > 0 ? ` (${s.messageCount})` : ''}
                </option>
              ))}
            </SelectField>
          )}
          <button
            type="button"
            onClick={handleNewChat}
            className="h-8 px-2 rounded-lg text-xs cursor-pointer flex items-center gap-1.5 flex-shrink-0"
            style={{
              border: '1px solid var(--color-border-soft)',
              background: 'var(--color-bg-input)',
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-body)',
              transition: 'background 150ms',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-bg-input)'}
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            新对话
          </button>
          <span className="text-xs truncate hidden sm:inline flex-shrink-0" style={{ color: 'var(--color-text-muted-soft)', fontFamily: 'var(--font-mono)' }}>
            #{chatId.slice(-6)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        loading={loadingHistory}
        hasMore={hasMoreHistory}
        onLoadMore={handleLoadMore}
        scrollTrigger={scrollTrigger}
        isWaiting={activeStreaming}
        onInterrupt={handleAbort}
        selectedWorkdir={activeBotId}
        chatId={chatId}
        onSend={handleSend}
        welcomeTitle={webChatConfig.welcomeTitle}
        welcomeSubtitle={webChatConfig.welcomeSubtitle}
        showQuickPrompts={webChatConfig.showQuickPrompts}
        activeTitle={activeDisplayName}
        activeSubtitle={activeContextMeta}
      />

      {/* Input */}
      <MessageInput
        onSend={handleSend}
        isStreaming={activeStreaming}
        onAbort={handleAbort}
        onResetSession={handleNewChat}
        draftKey={chatId}
        draftText={drafts[chatId] ?? ''}
        onDraftChange={(text) => {
          useChatStore.getState().saveDraft(chatId, text);
        }}
        placeholder={connected ? webChatConfig.inputPlaceholder : '正在等待服务器连接...'}
        disabled={!connected}
        statusText={inputStatusText}
        allowImageUpload={webChatConfig.enableImageUpload}
      />
    </div>
  );
}
