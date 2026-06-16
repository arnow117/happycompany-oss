import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { MessageBus } from './bus.js';
import type { AgentFactory } from './bot.js';
import type { MessageStore } from './store.js';
import { logger } from './logger.js';
import { MessageIngressRuntime } from './ingress/runtime.js';
import type { StreamEvent } from './stream-event.js';
import type { Config } from './config.js';
import type { MutableRef } from './web.js';
import type { RuntimeEmployeeDirectory } from './runtime-resolver.js';
import { RuntimeResolveError, RuntimeResolver } from './runtime-resolver.js';

export interface WebSocketDeps {
  agentFactory: AgentFactory;
  store: MessageStore;
  bus: MessageBus;
  corpDir?: string;
  configRef?: MutableRef<Config>;
  employeeManager?: RuntimeEmployeeDirectory;
  handleCommand?: (botName: string, chatId: string, text: string) => Promise<string | null>;
}

interface PendingChat {
  controller: AbortController;
}

interface StreamingSnapshot {
  botName: string;
  chatId: string;
  partialText: string;
  activeTools: Array<{
    toolName: string;
    toolUseId: string;
    startTime: number;
    toolInputSummary?: string;
    parentToolUseId?: string | null;
  }>;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  collaborations?: Array<{
    from: string;
    to: string;
    reason?: string;
    status: 'pending' | 'completed' | 'failed';
    result?: string;
    contractId?: string;
    parentContractId?: string;
    timestamp: number;
    completedAt?: number;
  }>;
  systemStatus: string | null;
  updatedAt: number;
}

export function attachWebSocket(
  rawServer: unknown,
  bus: MessageBus,
  deps: WebSocketDeps,
): void {
  const server = rawServer as HttpServer;
  const wss = new WebSocketServer({ server, path: '/api/ws' });

  const runtime = new MessageIngressRuntime({
    agentFactory: deps.agentFactory,
    store: deps.store,
    bus: deps.bus,
  });

  const pendingChats = new Map<string, PendingChat>();
  const streamingSnapshots = new Map<string, StreamingSnapshot>();
  const runtimeResolver = (): RuntimeResolver | null => {
    if (!deps.corpDir || !deps.configRef) return null;
    return new RuntimeResolver({
      corpDir: deps.corpDir,
      config: deps.configRef.current,
      employeeManager: deps.employeeManager,
    });
  };

  const snapshotKey = (botName: string, chatId: string): string => `${botName}:${chatId}`;

  const publishStoredMessage = (
    botName: string,
    chatId: string,
    text: string,
    source: 'user' | 'bot',
    options: { id?: string; userId?: string; attachments?: Array<{ type: 'image'; data: string; mimeType: string }> } = {},
  ): void => {
    const message = {
      id: options.id ?? `${source}-${crypto.randomUUID()}`,
      chatId,
      text,
      source,
      botName,
      timestamp: Date.now(),
      userId: options.userId,
      attachments: options.attachments,
    };
    deps.store.insert(message);
    deps.bus.publish({
      type: 'new_message',
      botName,
      chatId,
      messageId: message.id,
      text,
      message,
    });
  };

  const updateStreamingSnapshot = (botName: string, chatId: string, event: StreamEvent): void => {
    const key = snapshotKey(botName, chatId);
    let snap = streamingSnapshots.get(key);
    if (!snap) {
      snap = {
        botName,
        chatId,
        partialText: '',
        activeTools: [],
        systemStatus: null,
        updatedAt: Date.now(),
      };
    }

    snap.updatedAt = Date.now();
    switch (event.eventType) {
      case 'text_delta':
        if (event.text) {
          snap.partialText += event.text;
          if (snap.partialText.length > 4000) snap.partialText = snap.partialText.slice(-4000);
        }
        break;
      case 'tool_use_start':
        if (event.toolName && event.toolUseId) {
          const existing = snap.activeTools.find((tool) => tool.toolUseId === event.toolUseId);
          const nextTool = {
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            startTime: Date.now(),
            toolInputSummary: event.toolInputSummary,
            parentToolUseId: event.parentToolUseId,
          };
          snap.activeTools = existing
            ? snap.activeTools.map((tool) => (tool.toolUseId === event.toolUseId ? nextTool : tool))
            : [...snap.activeTools, nextTool];
        }
        break;
      case 'tool_use_end':
        if (event.toolUseId) {
          snap.activeTools = snap.activeTools.filter((tool) => tool.toolUseId !== event.toolUseId);
        }
        break;
      case 'handoff':
        if (event.handoffFrom && event.handoffTo) {
          snap.collaborations = [
            ...(snap.collaborations ?? []),
            {
              from: event.handoffFrom,
              to: event.handoffTo,
              reason: event.handoffReason,
              status: 'pending',
              contractId: event.contractId,
              parentContractId: event.parentContractId,
              timestamp: Date.now(),
            },
          ];
        }
        break;
      case 'handoff_result':
        if (event.handoffTo && event.handoffStatus) {
          const existing = snap.collaborations ?? [];
          let matchIndex = -1;
          for (let index = existing.length - 1; index >= 0; index -= 1) {
            const item = existing[index];
            if (item.to === event.handoffTo && (!event.contractId || item.contractId === event.contractId || !item.contractId)) {
              matchIndex = index;
              break;
            }
          }
          const now = Date.now();
          const updated = {
            ...(matchIndex >= 0
              ? existing[matchIndex]
              : {
                  from: event.handoffFrom ?? 'delegated',
                  to: event.handoffTo,
                  reason: event.handoffReason,
                  status: 'pending' as const,
                  timestamp: now,
                }),
            status: event.handoffStatus,
            result: event.handoffResult,
            contractId: event.contractId,
            parentContractId: event.parentContractId,
            completedAt: now,
          };
          snap.collaborations = matchIndex >= 0
            ? existing.map((item, index) => (index === matchIndex ? updated : item))
            : [...existing, updated];
        }
        break;
      case 'todo_update':
        snap.todos = event.todos;
        break;
      case 'status':
        snap.systemStatus = event.statusText ?? null;
        break;
    }

    streamingSnapshots.set(key, snap);
  };

  bus.subscribe((event) => {
    if (event.type === 'stream_event' && event.botName && event.chatId && event.event) {
      updateStreamingSnapshot(event.botName, event.chatId, event.event);
    }
    if (event.type === 'runner_state' && event.botName && event.chatId && event.state === 'idle') {
      streamingSnapshots.delete(snapshotKey(event.botName, event.chatId));
    }
    if (event.type === 'new_message' && event.message?.source === 'bot' && event.botName && event.chatId) {
      streamingSnapshots.delete(snapshotKey(event.botName, event.chatId));
    }
  });

  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected');
    const wsPendingKeys = new Set<string>();

    // Send snapshot of existing events
    const snapshot = bus.snapshot();
    if (snapshot.length > 0) {
      ws.send(JSON.stringify({ type: 'snapshot', events: snapshot }));
    }
    for (const snap of streamingSnapshots.values()) {
      ws.send(JSON.stringify({
        type: 'stream_snapshot',
        botName: snap.botName,
        chatId: snap.chatId,
        snapshot: {
          partialText: snap.partialText,
          activeTools: snap.activeTools,
          todos: snap.todos,
          collaborations: snap.collaborations,
          systemStatus: snap.systemStatus,
        },
      }));
    }

    const unsubscribe = bus.subscribe((event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : (raw as unknown as Buffer).toString('utf-8')) as Record<string, unknown>;
      } catch {
        logger.warn('WebSocket message parse error');
        return;
      }

      if (msg.type === 'send_message') {
        const tenant = typeof msg.tenant === 'string' ? msg.tenant : undefined;
        const entryId = typeof msg.entryId === 'string' ? msg.entryId : undefined;
        const actorId = typeof msg.actorId === 'string' ? msg.actorId : undefined;
        const target = msg.target && typeof msg.target === 'object' && !Array.isArray(msg.target)
          ? msg.target as { employeeId?: unknown }
          : undefined;
        const targetEmployeeId = typeof target?.employeeId === 'string' ? target.employeeId : undefined;
        const workdirId = (msg.workdirId ?? msg.botName ?? targetEmployeeId ?? entryId) as string;
        const chatId = msg.chatId as string;
        const text = (msg.content ?? msg.text) as string;
        const userId = (msg.userId as string) || undefined;
        const rawAttachments = msg.attachments as Array<{ data: string; mimeType: string }> | undefined;

        if (!chatId || (!text && !rawAttachments?.length) || (!workdirId && !(tenant && entryId && actorId))) {
          ws.send(JSON.stringify({
            type: 'ws_error',
            botName: workdirId,
            chatId,
            error: 'Missing runtime target, chatId, or text',
          }));
          return;
        }

        let runtimeInput: {
          botName: string;
          tenant?: string;
          entryId?: string;
          actorId?: string;
          sessionId?: string;
          employeeId?: string;
          instanceId?: string;
          workdir?: string;
          sdkSessionScope?: string;
          userId?: string;
        } = { botName: workdirId, tenant, userId };
        let resolvedKey = `${workdirId}:${chatId}`;
        if (tenant && entryId && actorId) {
          const resolver = runtimeResolver();
          if (!resolver) {
            ws.send(JSON.stringify({
              type: 'ws_error',
              botName: workdirId,
              chatId,
              error: 'Runtime resolver is not available',
            }));
            return;
          }
          try {
            const profile = resolver.resolve({
              tenant,
              entryId,
              actorId,
              chatId,
              text,
              attachments: rawAttachments,
              target: targetEmployeeId ? { employeeId: targetEmployeeId } : undefined,
            });
            runtimeInput = {
              botName: profile.employee.id,
              tenant: profile.tenant,
              entryId: profile.entry.id,
              actorId: profile.actor.actorId,
              sessionId: profile.instance.sdkSessionScope,
              employeeId: profile.employee.id,
              instanceId: profile.instance.instanceId,
              workdir: profile.instance.workdir,
              sdkSessionScope: profile.instance.sdkSessionScope,
              userId: profile.actor.peopleUserId ?? profile.actor.actorId,
            };
            resolvedKey = `${profile.employee.id}:${chatId}`;
          } catch (err) {
            const message = err instanceof RuntimeResolveError ? err.message : (err instanceof Error ? err.message : String(err));
            ws.send(JSON.stringify({
              type: 'ws_error',
              botName: workdirId,
              chatId,
              error: message,
              code: err instanceof RuntimeResolveError ? err.code : undefined,
            }));
            return;
          }
        }

        // Slash commands — bypass agent entirely
        if (deps.handleCommand && !(tenant && entryId && actorId)) {
          const cmdReply = await deps.handleCommand(workdirId, chatId, text);
          if (cmdReply !== null) {
            publishStoredMessage(workdirId, chatId, text, 'user', {
              id: `web-${crypto.randomUUID()}`,
              userId,
              attachments: rawAttachments?.map((a) => ({ type: 'image', ...a })),
            });
            publishStoredMessage(workdirId, chatId, cmdReply, 'bot', {
              id: `web-${crypto.randomUUID()}:reply`,
            });
            return;
          }
        }

        // Abort previous pending chat for this key if any
        const existing = pendingChats.get(resolvedKey);
        if (existing) {
          existing.controller.abort();
          pendingChats.delete(resolvedKey);
        }

        const controller = new AbortController();
        const pending: PendingChat = { controller };
        pendingChats.set(resolvedKey, pending);
        wsPendingKeys.add(resolvedKey);

        try {
          await runtime.handle(
            {
              channel: 'web',
              botName: runtimeInput.botName,
              tenant: runtimeInput.tenant,
              entryId: runtimeInput.entryId,
              actorId: runtimeInput.actorId,
              sessionId: runtimeInput.sessionId,
              employeeId: runtimeInput.employeeId,
              instanceId: runtimeInput.instanceId,
              workdir: runtimeInput.workdir,
              sdkSessionScope: runtimeInput.sdkSessionScope,
              mode: runtimeInput.sessionId ? 'single_employee' : undefined,
              chatId,
              text,
              userId: runtimeInput.userId,
              attachments: rawAttachments,
            },
            {
              abortController: controller,
            },
          );

          pendingChats.delete(resolvedKey);
        } catch (err: unknown) {
          pendingChats.delete(resolvedKey);

          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({
            err: errMsg,
            stack: err instanceof Error ? err.stack : undefined,
            workdirId: runtimeInput.botName,
            chatId,
          }, 'WebSocket chat error');

          publishStoredMessage(runtimeInput.botName, chatId, `[Error] ${errMsg}`, 'bot', {
            id: `web-error-${crypto.randomUUID()}`,
          });
        }
      } else if (msg.type === 'chat_abort') {
        const workdirId = (msg.workdirId ?? msg.botName) as string;
        const chatId = msg.chatId as string;
        const key = `${workdirId}:${chatId}`;

        const pending = pendingChats.get(key);
        if (pending) {
          deps.bus.publish({
            type: 'stream_event',
            botName: workdirId,
            chatId,
            event: { eventType: 'status', statusText: 'interrupted' },
          });
          pending.controller.abort();
          pendingChats.delete(key);
        }
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      unsubscribe();
      // Abort all pending chats for this connection
      for (const key of wsPendingKeys) {
        const pending = pendingChats.get(key);
        if (pending) {
          pending.controller.abort();
          pendingChats.delete(key);
        }
      }
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
      unsubscribe();
    });
  });

  logger.info('WebSocket server attached at /api/ws (bidirectional)');
}
