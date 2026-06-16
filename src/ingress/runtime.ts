import type { AgentFactory, RespondOptions } from '../bot.js';
import type { MessageBus } from '../bus.js';
import type { MessageStore } from '../store.js';
import type { FileAttachment } from '../types.js';
import { logger } from '../logger.js';
import type { StreamEvent } from '../stream-event.js';
import type { ConversationSession } from '../runtime-profile.js';
import type { AgentObservability, AgentObservabilityToolCall } from '../agent-observability.js';
import { TraceRecorder } from './trace-recorder.js';
import type {
  IngressCallbacks,
  IngressMessageInput,
  IngressResult,
  IngressRuntimeTrace,
} from './types.js';

export interface MessageIngressRuntimeDeps {
  agentFactory: AgentFactory;
  store: MessageStore;
  bus: MessageBus;
  /** Override for tests. Defaults to Date.now / crypto.randomUUID. */
  clock?: () => number;
  idGenerator?: () => string;
}

/**
 * Unified message ingress runtime. Every channel adapter (Web WS, DingTalk,
 * Feishu, Harness CLI) funnels through `handle()`. The runtime owns:
 *
 *   - user message persistence + `message_received` / `new_message` bus events
 *   - prompt assembly with files / inline attachments
 *   - delegation to `agentFactory.respond()` with stream callbacks
 *   - bot reply persistence + `agent_reply_sent` / `new_message` bus events
 *   - structured `IngressTrace` collection
 *
 * Adapters keep channel-specific concerns (protocol framing, file download,
 * dedup, sendStreaming card rendering) outside of this runtime.
 */
export class MessageIngressRuntime {
  private readonly clock: () => number;
  private readonly idGen: () => string;

  constructor(private readonly deps: MessageIngressRuntimeDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.idGen = deps.idGenerator ?? (() => crypto.randomUUID());
  }

  async handle(input: IngressMessageInput, callbacks: IngressCallbacks = {}): Promise<IngressResult> {
    const receivedAt = input.receivedAt ?? this.clock();
    const userMessageId = input.messageId ?? `${input.channel}-${this.idGen()}`;
    const session = this.buildConversationSession(input, receivedAt);

    const recorder = new TraceRecorder({
      channel: input.channel,
      botName: input.botName,
      tenant: input.tenant,
      userId: input.userId,
      chatId: input.chatId,
      messageId: userMessageId,
      runtime: buildRuntimeMeta(input),
      clock: this.clock,
    });
    const runtimeEventBase = {
      tenant: input.tenant,
      sessionId: input.sessionId,
      chatId: input.chatId,
      actorId: input.actorId,
    };
    const insertRuntimeEvent = (
      type: Parameters<MessageStore['insertRuntimeEvent']>[0]['type'],
      payload: Record<string, unknown>,
      options: { employeeId?: string; at?: number } = {},
    ): void => {
      if (!input.sessionId) return;
      this.deps.store.insertRuntimeEvent({
        id: `${input.sessionId}:${type}:${this.idGen()}`,
        ...runtimeEventBase,
        employeeId: options.employeeId ?? input.employeeId,
        type,
        payload,
        at: options.at ?? this.clock(),
      });
    };

    try {
      if (session) {
        this.deps.store.upsertConversationSession(session);
      }

      const userMessage = {
        id: userMessageId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        timestamp: receivedAt,
        text: input.text,
        source: 'user',
        botName: input.botName,
        tenant: input.tenant,
        entryId: input.entryId,
        actorId: input.actorId,
        employeeId: input.employeeId,
        instanceId: input.instanceId,
        workdir: input.workdir,
        mode: input.mode,
        userId: input.userId,
      } as const;
      this.deps.store.insert(userMessage);
      insertRuntimeEvent('user_message', { text: input.text }, {
        employeeId: input.employeeId,
        at: receivedAt,
      });

      this.deps.bus.publish({
        type: 'message_received',
        botName: input.botName,
        chatId: input.chatId,
        messageId: userMessageId,
        text: input.text,
      });
      this.deps.bus.publish({
        type: 'new_message',
        botName: input.botName,
        chatId: input.chatId,
        messageId: userMessageId,
        text: input.text,
        meta: runtimeMetaForEvent(input),
        message: {
          ...userMessage,
          attachments: input.attachments?.map((a) => ({ type: 'image', ...a })),
        },
      });

      const prompt = buildPrompt(input);
      let previousStreamText = '';
      const startedAt = this.clock();
      const observation: AgentObservability = {
        summary: { status: 'completed' },
        toolCalls: [],
        handoffs: [],
        startedAt,
        finishedAt: startedAt,
      };
      const publishStreamEvent = (event: StreamEvent): void => {
        this.deps.bus.publish({
          type: 'stream_event',
          botName: input.botName,
          chatId: input.chatId,
          meta: runtimeMetaForEvent(input),
          event,
        });
      };
      const publishTextDelta = (accumulatedText: string): void => {
        const delta = accumulatedText.startsWith(previousStreamText)
          ? accumulatedText.slice(previousStreamText.length)
          : accumulatedText;
        previousStreamText = accumulatedText;
        if (!delta) return;
        publishStreamEvent({ eventType: 'text_delta', text: delta });
      };

      this.deps.bus.publish({
        type: 'runner_state',
        botName: input.botName,
        chatId: input.chatId,
        meta: runtimeMetaForEvent(input),
        state: 'running',
      });

      const respondOpts: RespondOptions = {
        userId: input.userId,
        tenant: input.tenant,
        abortController: callbacks.abortController,
        timeoutMs: callbacks.timeoutMs,
        runtimeAgentDir: callbacks.runtimeAgentDir,
        runtimeCwd: callbacks.runtimeCwd,
        onText: (text) => {
          publishTextDelta(text);
          callbacks.onText?.(text);
        },
        onToolStart: (info) => {
          const toolCall: AgentObservabilityToolCall = {
            toolName: info.toolName,
            toolUseId: info.toolUseId,
            input: info.toolInput,
            status: 'running',
          };
          observation.toolCalls = [
            ...observation.toolCalls.filter((item) => item.toolUseId !== info.toolUseId),
            toolCall,
          ];
          publishStreamEvent({
            eventType: 'tool_use_start',
            toolName: info.toolName,
            toolUseId: info.toolUseId,
            toolInput: info.toolInput,
          });
          recorder.recordToolStart(info);
          insertRuntimeEvent('tool_call_started', {
            toolName: info.toolName,
            toolUseId: info.toolUseId,
            toolInput: info.toolInput,
          });
          callbacks.onToolStart?.(info);
        },
        onToolEnd: (info) => {
          observation.toolCalls = observation.toolCalls.map((item) => (
            item.toolUseId === info.toolUseId
              ? { ...item, elapsedMs: info.elapsedMs, status: 'completed' }
              : item
          ));
          publishStreamEvent({
            eventType: 'tool_use_end',
            toolName: info.toolName,
            toolUseId: info.toolUseId,
            elapsedSeconds: info.elapsedMs / 1000,
          });
          recorder.recordToolEnd(info);
          insertRuntimeEvent('tool_call_completed', {
            toolName: info.toolName,
            toolUseId: info.toolUseId,
            elapsedMs: info.elapsedMs,
          });
          callbacks.onToolEnd?.(info);
        },
        onRoutingDecision: (info) => {
          recorder.recordRouting(info);
          insertRuntimeEvent('routing_decision', { ...info });
        },
        onHandoff: (info) => {
          recorder.recordHandoff(info);
          observation.handoffs = [
            ...observation.handoffs,
            {
              from: info.from,
              to: info.to,
              reason: info.reason,
              status: 'pending',
            },
          ];
          insertRuntimeEvent('handoff_requested', {
            fromEmployeeId: info.from,
            toEmployeeId: info.to,
            reason: info.reason,
          }, { employeeId: info.from });
          publishStreamEvent({
            eventType: 'handoff',
            handoffFrom: info.from,
            handoffTo: info.to,
            handoffReason: info.reason,
          });
          callbacks.onHandoff?.(info);
        },
        onMemoryOp: (info) => {
          recorder.recordMemory(info);
          insertRuntimeEvent('memory_op', { ...info });
        },
        onBusinessArtifact: (info) => {
          recorder.recordBusinessArtifact(info);
          insertRuntimeEvent('business_artifact', { ...info });
        },
        onInit: (info) => {
          observation.init = info;
        },
        onUsage: (info) => {
          observation.usage = info;
          publishStreamEvent({ eventType: 'usage', usage: info });
        },
        onResultSummary: (info) => {
          observation.summary = info;
        },
        handoffMode: callbacks.handoffMode,
      };

      const reply = await this.deps.agentFactory.respond(
        prompt,
        input.chatId,
        input.botName,
        respondOpts,
      );

      const replyId = `${userMessageId}:reply`;
      const replyAt = Math.max(this.clock(), receivedAt + 1);
      observation.finishedAt = replyAt;
      const botMessage = {
        id: replyId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        timestamp: replyAt,
        text: reply,
        source: 'bot',
        botName: input.botName,
        tenant: input.tenant,
        entryId: input.entryId,
        actorId: input.actorId,
        employeeId: input.employeeId,
        instanceId: input.instanceId,
        workdir: input.workdir,
        mode: input.mode,
        observability: observation,
      } as const;
      this.deps.store.insert(botMessage);
      insertRuntimeEvent('agent_message', { text: reply }, {
        employeeId: input.employeeId,
        at: replyAt,
      });

      this.deps.bus.publish({
        type: 'agent_reply_sent',
        botName: input.botName,
        chatId: input.chatId,
        text: reply,
      });
      this.deps.bus.publish({
        type: 'new_message',
        botName: input.botName,
        chatId: input.chatId,
        messageId: replyId,
        text: reply,
        meta: runtimeMetaForEvent(input),
        message: botMessage,
      });
      this.deps.bus.publish({
        type: 'runner_state',
        botName: input.botName,
        chatId: input.chatId,
        meta: runtimeMetaForEvent(input),
        state: 'idle',
      });

      return { reply, trace: recorder.finish() };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      recorder.recordError('runtime', message);
      insertRuntimeEvent('error', { stage: 'runtime', message });
      logger.warn(
        { err: message, channel: input.channel, botName: input.botName, chatId: input.chatId },
        'MessageIngressRuntime.handle failed',
      );
      this.deps.bus.publish({
        type: 'stream_event',
        botName: input.botName,
        chatId: input.chatId,
        meta: runtimeMetaForEvent(input),
        event: { eventType: 'status', statusText: 'error' },
      });
      this.deps.bus.publish({
        type: 'runner_state',
        botName: input.botName,
        chatId: input.chatId,
        meta: runtimeMetaForEvent(input),
        state: 'idle',
      });
      // Rethrow so adapters can render channel-specific errors.
      // Trace is still attached as a non-enumerable hint for debugging.
      const wrapped = err instanceof Error ? err : new Error(message);
      (wrapped as Error & { trace?: unknown }).trace = recorder.finish();
      throw wrapped;
    }
  }

  private buildConversationSession(input: IngressMessageInput, timestamp: number): ConversationSession | null {
    if (
      !input.sessionId ||
      !input.tenant ||
      !input.entryId ||
      !input.actorId ||
      !input.employeeId ||
      !input.instanceId ||
      !input.workdir ||
      !input.sdkSessionScope
    ) {
      return null;
    }
    const existing = this.deps.store.getRuntimeSession(input.sessionId);
    const preserveWorkflowGroup = existing?.mode === 'workflow_group';
    return {
      id: input.sessionId,
      tenant: input.tenant,
      entryId: input.entryId,
      channel: input.channel,
      actorId: input.actorId,
      chatId: input.chatId,
      employeeId: preserveWorkflowGroup ? existing.employeeId : input.employeeId,
      instanceId: preserveWorkflowGroup ? existing.instanceId : input.instanceId,
      workdir: preserveWorkflowGroup ? existing.workdir : input.workdir,
      sdkSessionScope: preserveWorkflowGroup ? existing.sdkSessionScope : input.sdkSessionScope,
      mode: input.mode ?? 'single_employee',
      title: existing?.title,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      archivedAt: existing?.archivedAt,
    };
  }
}

function buildRuntimeMeta(input: IngressMessageInput): IngressRuntimeTrace | undefined {
  const meta: IngressRuntimeTrace = {};
  if (input.tenant) meta.tenant = input.tenant;
  if (input.entryId) meta.entryId = input.entryId;
  if (input.actorId) meta.actorId = input.actorId;
  if (input.sessionId) meta.sessionId = input.sessionId;
  if (input.employeeId) meta.employeeId = input.employeeId;
  if (input.instanceId) meta.instanceId = input.instanceId;
  if (input.workdir) meta.workdir = input.workdir;
  if (input.sdkSessionScope) meta.sdkSessionScope = input.sdkSessionScope;
  if (input.mode) meta.mode = input.mode;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function runtimeMetaForEvent(input: IngressMessageInput): Record<string, unknown> | undefined {
  const meta = buildRuntimeMeta(input);
  return meta ? { ...meta } : undefined;
}

function buildPrompt(input: IngressMessageInput): string {
  let prompt = input.text;

  if (input.attachments?.length) {
    const md = input.attachments
      .map((a) => `![image](data:${a.mimeType};base64,${a.data})`)
      .join('\n');
    prompt = `${md}\n\n${prompt}`;
  }

  prompt = appendFilesToPrompt(prompt, input.files);
  return prompt;
}

function appendFilesToPrompt(text: string, files?: FileAttachment[]): string {
  if (!files?.length) return text;
  let out = text;
  for (const f of files) {
    if (f.textContent) {
      const fence = `FILE_${Math.random().toString(36).slice(2, 10)}`;
      out += `\n\n[${f.name} content]\n${fence}\n${f.textContent}\n${fence}`;
    }
    if (f.base64) {
      out += `\n\n[Image attached: ${f.name}]`;
    }
  }
  return out;
}
