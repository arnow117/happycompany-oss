import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentFactory } from '../bot.js';
import type { MessageBus } from '../bus.js';
import type { Config } from '../config.js';
import { MessageIngressRuntime } from '../ingress/runtime.js';
import { RuntimeResolveError, RuntimeResolver, type RuntimeEmployeeDirectory } from '../runtime-resolver.js';
import type {
  ConversationMode,
  RuntimeEvent,
  RuntimeSessionSummary,
  WorkflowCase,
  WorkflowHandoffStatus,
  WorkflowThreadState,
  WorkflowTimelineEvent,
} from '../runtime-profile.js';
import type { PersistedMessage } from '../store.js';
import type { MessageStore } from '../store.js';
import type { MutableRef } from '../web.js';

export interface RuntimeRoutesDeps {
  corpDir: string;
  configRef: MutableRef<Config>;
  employeeManager?: RuntimeEmployeeDirectory;
  store: MessageStore;
  agentFactory?: AgentFactory;
  bus?: MessageBus;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOffset(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseMode(value: string | undefined): ConversationMode | undefined {
  if (value === 'single_employee' || value === 'workflow_group' || value === 'builder_sandbox') return value;
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function parseWorkflowState(value: string | undefined): WorkflowThreadState | undefined {
  if (value === 'open' || value === 'waiting' || value === 'completed' || value === 'cancelled') return value;
  return undefined;
}

function parseHandoffStatus(value: string | undefined): WorkflowHandoffStatus {
  if (value === 'requested' || value === 'accepted' || value === 'completed' || value === 'failed') return value;
  return 'requested';
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function collectParticipants(session: RuntimeSessionSummary, events: RuntimeEvent[], messages: PersistedMessage[]): string[] {
  const participants = new Set<string>();
  participants.add(session.employeeId);
  for (const message of messages) {
    if (message.employeeId) participants.add(message.employeeId);
  }
  for (const event of events) {
    if (event.employeeId) participants.add(event.employeeId);
    const from = readPayloadString(event.payload, 'fromEmployeeId');
    const to = readPayloadString(event.payload, 'toEmployeeId');
    if (from) participants.add(from);
    if (to) participants.add(to);
    const selected = readPayloadString(event.payload, 'selectedEmployee');
    if (selected) participants.add(selected);
  }
  return [...participants];
}

function currentEmployeeFor(session: RuntimeSessionSummary, events: RuntimeEvent[], messages: PersistedMessage[]): string {
  for (const event of [...events].reverse()) {
    if (event.type !== 'handoff_requested') continue;
    const to = readPayloadString(event.payload, 'toEmployeeId');
    if (to) return to;
  }
  for (const event of [...events].reverse()) {
    const selected = readPayloadString(event.payload, 'selectedEmployee');
    if (selected) return selected;
    if (event.employeeId) return event.employeeId;
  }
  for (const message of [...messages].reverse()) {
    if (message.employeeId) return message.employeeId;
  }
  return session.employeeId;
}

function caseStateFor(session: RuntimeSessionSummary, events: RuntimeEvent[]): WorkflowCase['state'] {
  if (session.archivedAt) return 'archived';
  if (events.some((event) => event.type === 'error')) return 'failed';
  return 'active';
}

function buildWorkflowCase(session: RuntimeSessionSummary, events: RuntimeEvent[], messages: PersistedMessage[]): WorkflowCase {
  const lastEventAt = events.reduce((max, event) => Math.max(max, event.at), 0);
  return {
    id: session.id,
    tenant: session.tenant,
    sessionId: session.id,
    entryId: session.entryId,
    actorId: session.actorId,
    chatId: session.chatId,
    title: session.title,
    state: caseStateFor(session, events),
    currentEmployeeId: currentEmployeeFor(session, events, messages),
    participants: collectParticipants(session, events, messages),
    handoffCount: events.filter((event) => event.type === 'handoff_requested').length,
    toolCallCount: events.filter((event) => event.type === 'tool_call_started').length,
    lastMessageAt: Math.max(session.lastMessageAt, lastEventAt),
    messageCount: session.messageCount,
    preview: session.preview,
    archivedAt: session.archivedAt,
  };
}

function messageToTimelineEvent(message: PersistedMessage): WorkflowTimelineEvent {
  return {
    id: message.id,
    type: message.source === 'user' ? 'user_message' : 'agent_message',
    at: message.timestamp,
    employeeId: message.employeeId,
    text: message.text,
    payload: {
      botName: message.botName,
      source: message.source,
    },
  };
}

function runtimeEventToTimelineEvent(event: RuntimeEvent): WorkflowTimelineEvent {
  if (event.type === 'handoff_requested') {
    return {
      id: event.id,
      type: 'handoff',
      at: event.at,
      employeeId: event.employeeId,
      fromEmployeeId: readPayloadString(event.payload, 'fromEmployeeId'),
      toEmployeeId: readPayloadString(event.payload, 'toEmployeeId'),
      reason: readPayloadString(event.payload, 'reason'),
      payload: event.payload,
    };
  }
  if (event.type === 'tool_call_started' || event.type === 'tool_call_completed') {
    return {
      id: event.id,
      type: 'tool_call',
      at: event.at,
      employeeId: event.employeeId,
      toolName: readPayloadString(event.payload, 'toolName'),
      status: event.type === 'tool_call_started' ? 'started' : 'completed',
      payload: event.payload,
    };
  }
  if (event.type === 'routing_decision') {
    return {
      id: event.id,
      type: 'routing_decision',
      at: event.at,
      employeeId: readPayloadString(event.payload, 'selectedEmployee') ?? event.employeeId,
      payload: event.payload,
    };
  }
  if (event.type === 'memory_op') {
    return {
      id: event.id,
      type: 'memory',
      at: event.at,
      employeeId: event.employeeId,
      status: readPayloadString(event.payload, 'status'),
      payload: event.payload,
    };
  }
  if (event.type === 'business_artifact') {
    return {
      id: event.id,
      type: 'business_artifact',
      at: event.at,
      employeeId: event.employeeId,
      status: readPayloadString(event.payload, 'status'),
      artifactType: readPayloadString(event.payload, 'type'),
      artifactId: readPayloadString(event.payload, 'id'),
      payload: event.payload,
    };
  }
  if (event.type === 'error') {
    return {
      id: event.id,
      type: 'error',
      at: event.at,
      employeeId: event.employeeId,
      stage: readPayloadString(event.payload, 'stage'),
      message: readPayloadString(event.payload, 'message'),
      payload: event.payload,
    };
  }
  return {
    id: event.id,
    type: event.type === 'user_message' ? 'user_message' : 'agent_message',
    at: event.at,
    employeeId: event.employeeId,
    text: readPayloadString(event.payload, 'text'),
    payload: event.payload,
  };
}

const createWorkflowBodySchema = z.object({
  id: z.string().min(1).optional(),
  tenant: z.string().min(1),
  entryId: z.string().min(1),
  actorId: z.string().min(1),
  ownerEmployeeId: z.string().min(1),
  participantEmployeeIds: z.array(z.string().min(1)).optional(),
  parentSessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
});

const runtimeMessageBodySchema = z.object({
  tenant: z.string().min(1),
  entryId: z.string().min(1),
  actorId: z.string().min(1),
  chatId: z.string().min(1),
  text: z.string().min(1),
  attachments: z.array(z.object({
    data: z.string().min(1),
    mimeType: z.string().min(1),
  })).optional(),
  target: z.object({
    employeeId: z.string().min(1).optional(),
    workflowThreadId: z.string().min(1).optional(),
    draftId: z.string().min(1).optional(),
  }).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

const workflowHandoffBodySchema = z.object({
  fromEmployeeId: z.string().min(1),
  toEmployeeId: z.string().min(1),
  reason: z.string().optional(),
  status: z.enum(['requested', 'accepted', 'completed', 'failed']).optional(),
});

const workflowMessageBodySchema = z.object({
  text: z.string().min(1),
  targetEmployeeId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

function statusForError(err: RuntimeResolveError): 400 | 404 | 409 {
  switch (err.code) {
    case 'tenant_not_found':
    case 'entry_not_found':
    case 'actor_not_found':
    case 'employee_not_found':
      return 404;
    case 'binding_required':
      return 409;
    case 'cross_tenant_employee':
    case 'unsafe_workdir':
      return 400;
  }
}

function errorBody(err: RuntimeResolveError): { error: string; code: string } {
  return { error: err.message, code: err.code };
}

export function registerRuntimeRoutes(app: Hono, deps: RuntimeRoutesDeps): void {
  const resolver = (): RuntimeResolver => new RuntimeResolver({
    corpDir: deps.corpDir,
    config: deps.configRef.current,
    employeeManager: deps.employeeManager,
  });
  const messageRuntime = deps.agentFactory && deps.bus
    ? new MessageIngressRuntime({
        agentFactory: deps.agentFactory,
        store: deps.store,
        bus: deps.bus,
      })
    : null;

  app.get('/api/runtime/entries', (c) => {
    const tenant = c.req.query('tenant');
    return c.json({ entries: resolver().listEntries(tenant) });
  });

  app.get('/api/runtime/actors', (c) => {
    const tenant = c.req.query('tenant');
    if (!tenant) return c.json({ error: 'tenant is required' }, 400);
    try {
      return c.json({ actors: resolver().listActors(tenant) });
    } catch (err) {
      if (err instanceof RuntimeResolveError) {
        return c.json(errorBody(err), statusForError(err));
      }
      throw err;
    }
  });

  app.get('/api/runtime/targets', (c) => {
    const tenant = c.req.query('tenant');
    const actorId = c.req.query('actorId');
    if (!tenant) return c.json({ error: 'tenant is required' }, 400);
    if (!actorId) return c.json({ error: 'actorId is required' }, 400);
    try {
      return c.json({ targets: resolver().listTargets(tenant, actorId) });
    } catch (err) {
      if (err instanceof RuntimeResolveError) {
        return c.json(errorBody(err), statusForError(err));
      }
      throw err;
    }
  });

  app.post('/api/runtime/messages', async (c) => {
    if (!messageRuntime) {
      return c.json({ error: 'Runtime message handler is not configured' }, 501);
    }
    const parsed = runtimeMessageBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const body = parsed.data;

    try {
      const profile = resolver().resolve({
        tenant: body.tenant,
        entryId: body.entryId,
        actorId: body.actorId,
        chatId: body.chatId,
        text: body.text,
        attachments: body.attachments,
        target: body.target,
      });
      const result = await messageRuntime.handle({
        channel: profile.entry.channel,
        botName: profile.employee.id,
        tenant: profile.tenant,
        entryId: profile.entry.id,
        actorId: profile.actor.actorId,
        userId: profile.actor.peopleUserId ?? profile.actor.actorId,
        chatId: body.chatId,
        sessionId: profile.instance.sdkSessionScope,
        employeeId: profile.employee.id,
        instanceId: profile.instance.instanceId,
        workdir: profile.instance.workdir,
        sdkSessionScope: profile.instance.sdkSessionScope,
        mode: 'single_employee',
        text: body.text,
        attachments: body.attachments,
      }, { timeoutMs: body.timeoutMs });
      return c.json({
        reply: result.reply,
        trace: result.trace,
        session: deps.store.getRuntimeSession(profile.instance.sdkSessionScope),
        runtime: {
          tenant: profile.tenant,
          entryId: profile.entry.id,
          actorId: profile.actor.actorId,
          employeeId: profile.employee.id,
          instanceId: profile.instance.instanceId,
          workdir: profile.instance.workdir,
          sdkSessionScope: profile.instance.sdkSessionScope,
        },
      });
    } catch (err) {
      if (err instanceof RuntimeResolveError) {
        return c.json(errorBody(err), statusForError(err));
      }
      throw err;
    }
  });

  app.get('/api/runtime/sessions', (c) => {
    const sessions = deps.store.listRuntimeSessions({
      tenant: c.req.query('tenant'),
      entryId: c.req.query('entryId'),
      actorId: c.req.query('actorId'),
      employeeId: c.req.query('employeeId'),
      mode: parseMode(c.req.query('mode')),
      includeArchived: parseBoolean(c.req.query('includeArchived')),
      limit: parseLimit(c.req.query('limit')),
      offset: parseOffset(c.req.query('offset')),
    });
    return c.json({ sessions });
  });

  app.get('/api/runtime/sessions/:id', (c) => {
    const session = deps.store.getRuntimeSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ session });
  });

  app.get('/api/runtime/sessions/:id/messages', (c) => {
    const session = deps.store.getRuntimeSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({
      session,
      messages: deps.store.listMessagesForSession(session.id, parseLimit(c.req.query('limit')) ?? 100),
    });
  });

  app.get('/api/runtime/cases', (c) => {
    const tenant = c.req.query('tenant');
    const caseLimit = parseLimit(c.req.query('limit')) ?? 100;
    const sessions = deps.store.listRuntimeSessions({
      tenant,
      includeArchived: parseBoolean(c.req.query('includeArchived')),
      limit: Math.max(caseLimit * 5, caseLimit),
    });
    const cases = sessions
      .map((session) => {
        const events = deps.store.listRuntimeEvents({ sessionId: session.id, limit: 500 });
        const messages = deps.store.listMessagesForSession(session.id, 200);
        return buildWorkflowCase(session, events, messages);
      })
      .filter((item) => item.handoffCount > 0)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, caseLimit);
    return c.json({ cases });
  });

  app.get('/api/runtime/cases/:id/timeline', (c) => {
    const session = deps.store.getRuntimeSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Case not found' }, 404);
    const messages = deps.store.listMessagesForSession(session.id, 500);
    const events = deps.store
      .listRuntimeEvents({ sessionId: session.id, limit: 1000 })
      .filter((event) => event.type !== 'user_message' && event.type !== 'agent_message');
    const workflowCase = buildWorkflowCase({
      id: session.id,
      tenant: session.tenant,
      entryId: session.entryId,
      channel: session.channel,
      actorId: session.actorId,
      chatId: session.chatId,
      employeeId: session.employeeId,
      instanceId: session.instanceId,
      workdir: session.workdir,
      sdkSessionScope: session.sdkSessionScope,
      mode: session.mode,
      title: session.title,
      lastMessageAt: session.updatedAt,
      messageCount: messages.length,
      preview: messages[messages.length - 1]?.text ?? '',
      archivedAt: session.archivedAt,
    }, events, messages);
    if (workflowCase.handoffCount === 0) return c.json({ error: 'Case not found' }, 404);
    const timeline = [
      ...messages.map(messageToTimelineEvent),
      ...events.map(runtimeEventToTimelineEvent),
    ].sort((a, b) => {
      if (a.at === b.at) return a.id.localeCompare(b.id);
      return a.at - b.at;
    });
    return c.json({
      case: workflowCase,
      timeline,
    });
  });

  app.delete('/api/runtime/sessions/:id', (c) => {
    const session = deps.store.archiveRuntimeSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ archived: true, session });
  });

  app.get('/api/runtime/workflows', (c) => {
    const workflows = deps.store.listWorkflowThreads({
      tenant: c.req.query('tenant'),
      actorId: c.req.query('actorId'),
      state: parseWorkflowState(c.req.query('state')),
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ workflows });
  });

  app.post('/api/runtime/workflows', async (c) => {
    const parsed = createWorkflowBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const body = parsed.data;
    const threadId = body.id ?? `workflow-${randomUUID()}`;
    const chatId = `workflow:${threadId}`;

    try {
      const profile = resolver().resolve({
        tenant: body.tenant,
        entryId: body.entryId,
        actorId: body.actorId,
        chatId,
        text: '',
        target: { employeeId: body.ownerEmployeeId },
      });
      const now = Date.now();
      const sessionId = `${body.tenant}:workflow:${threadId}`;
      const instanceId = `${body.tenant}:workflow:${threadId}`;
      const sdkSessionScope = sessionId;
      const participantIds = Array.from(new Set([body.ownerEmployeeId, ...(body.participantEmployeeIds ?? [])]));
      for (const employeeId of participantIds) {
        if (!deps.employeeManager?.get(employeeId, body.tenant)) {
          return c.json({ error: `Employee not found: ${body.tenant}/${employeeId}` }, 404);
        }
      }
      deps.store.upsertConversationSession({
        id: sessionId,
        tenant: body.tenant,
        entryId: body.entryId,
        channel: profile.entry.channel,
        actorId: body.actorId,
        chatId,
        employeeId: body.ownerEmployeeId,
        instanceId,
        workdir: profile.instance.workdir,
        sdkSessionScope,
        mode: 'workflow_group',
        title: body.title,
        createdAt: now,
        updatedAt: now,
      });

      const workflow = {
        id: threadId,
        tenant: body.tenant,
        sessionId,
        parentSessionId: body.parentSessionId,
        entryId: body.entryId,
        actorId: body.actorId,
        ownerEmployeeId: body.ownerEmployeeId,
        state: 'open' as const,
        participants: participantIds.map((employeeId, index) => ({
          employeeId,
          instanceId: `${body.tenant}:workflow:${threadId}:${employeeId}`,
          role: index === 0 ? 'owner' as const : 'participant' as const,
          joinedAt: now,
        })),
        handoffs: [],
        summary: body.summary,
        createdAt: now,
        updatedAt: now,
      };
      deps.store.upsertWorkflowThread(workflow);
      return c.json({ workflow, session: deps.store.getRuntimeSession(sessionId) }, 201);
    } catch (err) {
      if (err instanceof RuntimeResolveError) {
        return c.json(errorBody(err), statusForError(err));
      }
      throw err;
    }
  });

  app.get('/api/runtime/workflows/:id', (c) => {
    const workflow = deps.store.getWorkflowThread(c.req.param('id'));
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
    const session = deps.store.getRuntimeSession(workflow.sessionId);
    return c.json({ workflow, session });
  });

  app.post('/api/runtime/workflows/:id/handoff', async (c) => {
    const existing = deps.store.getWorkflowThread(c.req.param('id'));
    if (!existing) return c.json({ error: 'Workflow not found' }, 404);
    const parsed = workflowHandoffBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const body = parsed.data;
    if (!existing.participants.some((item) => item.employeeId === body.fromEmployeeId)) {
      return c.json({ error: `Source employee is not a workflow participant: ${body.fromEmployeeId}` }, 409);
    }
    if (!deps.employeeManager?.get(body.toEmployeeId, existing.tenant)) {
      return c.json({ error: `Employee not found: ${existing.tenant}/${body.toEmployeeId}` }, 404);
    }
    const now = Date.now();
    const workflow = deps.store.appendWorkflowHandoff(existing.id, {
      fromEmployeeId: body.fromEmployeeId,
      toEmployeeId: body.toEmployeeId,
      reason: body.reason,
      status: parseHandoffStatus(body.status),
      at: now,
    }, {
      employeeId: body.toEmployeeId,
      instanceId: `${existing.tenant}:workflow:${existing.id}:${body.toEmployeeId}`,
      role: 'participant',
      joinedAt: now,
    });
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
    return c.json({ workflow });
  });

  app.post('/api/runtime/workflows/:id/messages', async (c) => {
    if (!messageRuntime) {
      return c.json({ error: 'Workflow runtime is not configured' }, 501);
    }
    const workflow = deps.store.getWorkflowThread(c.req.param('id'));
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
    if (workflow.state !== 'open' && workflow.state !== 'waiting') {
      return c.json({ error: `Workflow is not open: ${workflow.state}` }, 409);
    }
    const session = deps.store.getRuntimeSession(workflow.sessionId);
    if (!session) return c.json({ error: 'Workflow session not found' }, 404);
    const parsed = workflowMessageBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const body = parsed.data;
    const targetEmployeeId = body.targetEmployeeId ?? workflow.ownerEmployeeId;
    const participant = workflow.participants.find((item) => item.employeeId === targetEmployeeId);
    if (!participant) {
      return c.json({ error: `Target employee is not a workflow participant: ${targetEmployeeId}` }, 409);
    }

    try {
      const profile = resolver().resolve({
        tenant: workflow.tenant,
        entryId: workflow.entryId,
        actorId: workflow.actorId,
        chatId: session.chatId,
        text: body.text,
        target: { employeeId: targetEmployeeId },
      });
      const result = await messageRuntime.handle({
        channel: session.channel,
        botName: targetEmployeeId,
        tenant: workflow.tenant,
        entryId: workflow.entryId,
        actorId: workflow.actorId,
        userId: workflow.actorId,
        chatId: session.chatId,
        sessionId: workflow.sessionId,
        employeeId: targetEmployeeId,
        instanceId: participant.instanceId,
        workdir: profile.instance.workdir,
        sdkSessionScope: session.sdkSessionScope,
        mode: 'workflow_group',
        text: body.text,
      }, { timeoutMs: body.timeoutMs });
      const now = Date.now();
      const nextWorkflow = {
        ...workflow,
        updatedAt: now,
      };
      deps.store.upsertWorkflowThread(nextWorkflow);
      return c.json({
        workflow: nextWorkflow,
        session: deps.store.getRuntimeSession(workflow.sessionId),
        reply: result.reply,
        trace: result.trace,
      });
    } catch (err) {
      if (err instanceof RuntimeResolveError) {
        return c.json(errorBody(err), statusForError(err));
      }
      throw err;
    }
  });
}
