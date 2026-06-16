import type {
  IngressAgentTrace,
  IngressBusinessArtifactStatus,
  IngressChannel,
  IngressHandoffTrace,
  IngressMemoryOp,
  IngressMemoryTrace,
  IngressRuntimeTrace,
  IngressRoutingTrace,
  IngressToolCallTrace,
  IngressTrace,
} from './types.js';

interface TraceRecorderInit {
  channel: IngressChannel;
  botName: string;
  tenant?: string;
  userId?: string;
  chatId: string;
  messageId?: string;
  runtime?: IngressRuntimeTrace;
  clock?: () => number;
}

export class TraceRecorder {
  private readonly trace: IngressTrace;
  private readonly toolByUseId = new Map<string, IngressToolCallTrace>();
  private readonly clock: () => number;

  constructor(init: TraceRecorderInit) {
    this.clock = init.clock ?? Date.now;
    this.trace = {
      input: {
        channel: init.channel,
        botName: init.botName,
        tenant: init.tenant,
        userId: init.userId,
        chatId: init.chatId,
        messageId: init.messageId,
      },
      routing: {},
      runtime: init.runtime ? { ...init.runtime } : undefined,
      toolCalls: [],
      memory: [],
      handoffs: [],
      businessArtifacts: [],
      errors: [],
      startedAt: this.clock(),
    };
  }

  recordRouting(patch: Partial<IngressRoutingTrace>): void {
    this.trace.routing = { ...this.trace.routing, ...patch };
  }

  recordAgent(agent: IngressAgentTrace): void {
    this.trace.agent = agent;
  }

  recordToolStart(info: { toolName: string; toolUseId: string }): void {
    const entry: IngressToolCallTrace = {
      name: info.toolName,
      toolUseId: info.toolUseId,
      status: 'running',
      startedAt: this.clock(),
    };
    this.trace.toolCalls.push(entry);
    this.toolByUseId.set(info.toolUseId, entry);
  }

  recordToolEnd(info: { toolName: string; toolUseId: string; elapsedMs: number }): void {
    const finishedAt = this.clock();
    const existing = this.toolByUseId.get(info.toolUseId);
    if (existing) {
      existing.status = 'complete';
      existing.elapsedMs = info.elapsedMs;
      existing.finishedAt = finishedAt;
      return;
    }
    this.trace.toolCalls.push({
      name: info.toolName,
      toolUseId: info.toolUseId,
      status: 'complete',
      elapsedMs: info.elapsedMs,
      startedAt: finishedAt - info.elapsedMs,
      finishedAt,
    });
  }

  recordToolError(info: { toolName: string; toolUseId: string; message: string }): void {
    const finishedAt = this.clock();
    const existing = this.toolByUseId.get(info.toolUseId);
    if (existing) {
      existing.status = 'error';
      existing.finishedAt = finishedAt;
    } else {
      this.trace.toolCalls.push({
        name: info.toolName,
        toolUseId: info.toolUseId,
        status: 'error',
        startedAt: finishedAt,
        finishedAt,
      });
    }
    this.recordError('tool', `${info.toolName}: ${info.message}`);
  }

  recordMemory(entry: {
    operation: IngressMemoryOp;
    subject: string;
    workspace?: string;
    status?: 'ok' | 'error';
  }): void {
    this.trace.memory.push({
      operation: entry.operation,
      subject: entry.subject,
      workspace: entry.workspace,
      status: entry.status ?? 'ok',
      at: this.clock(),
    });
  }

  recordHandoff(entry: { from: string; to: string; reason?: string }): void {
    this.trace.handoffs.push({
      from: entry.from,
      to: entry.to,
      reason: entry.reason,
      at: this.clock(),
    });
  }

  recordBusinessArtifact(entry: {
    type: string;
    id?: string;
    status?: IngressBusinessArtifactStatus;
  }): void {
    this.trace.businessArtifacts.push({
      type: entry.type,
      id: entry.id,
      status: entry.status ?? 'created',
      at: this.clock(),
    });
  }

  recordError(stage: string, message: string): void {
    this.trace.errors.push({ stage, message, at: this.clock() });
  }

  finish(): IngressTrace {
    if (this.trace.finishedAt === undefined) {
      this.trace.finishedAt = this.clock();
    }
    return this.snapshot();
  }

  snapshot(): IngressTrace {
    return {
      ...this.trace,
      routing: { ...this.trace.routing },
      runtime: this.trace.runtime ? { ...this.trace.runtime } : undefined,
      agent: this.trace.agent ? { ...this.trace.agent } : undefined,
      toolCalls: this.trace.toolCalls.map((t) => ({ ...t })),
      memory: this.trace.memory.map((m) => ({ ...m })),
      handoffs: this.trace.handoffs.map((h) => ({ ...h })),
      businessArtifacts: this.trace.businessArtifacts.map((a) => ({ ...a })),
      errors: this.trace.errors.map((e) => ({ ...e })),
    };
  }
}
