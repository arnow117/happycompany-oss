import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { logger } from './logger.js';
import { computeInitialNextRun } from './scheduler.js';
import type { ScheduleType, ScheduledTask, CreateTaskInput } from './scheduler.js';
import type { AgentObservability } from './agent-observability.js';
import type {
  ConversationMode,
  ConversationSession,
  EntryChannel,
  RuntimeEvent,
  RuntimeEventFilter,
  RuntimeEventType,
  RuntimeSessionSummary,
  WorkflowHandoffEvent,
  WorkflowParticipant,
  WorkflowThread,
  WorkflowThreadState,
} from './runtime-profile.js';

export interface PersistedMessage {
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
  mode?: ConversationMode;
  text: string;
  source: 'user' | 'bot' | 'self' | 'agent';
  fromBotName?: string;
  userId?: string;
  observability?: AgentObservability;
}

export interface ChatSummary {
  chatId: string;
  botName: string;
  label?: string;
  lastMessageAt: number;
  messageCount: number;
}

export interface RuntimeSessionFilter {
  tenant?: string;
  entryId?: string;
  actorId?: string;
  employeeId?: string;
  mode?: ConversationMode;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface WorkflowThreadFilter {
  tenant?: string;
  actorId?: string;
  state?: WorkflowThreadState;
  limit?: number;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    session_id TEXT,
    timestamp  INTEGER NOT NULL,
    bot_name   TEXT,
    tenant     TEXT,
    entry_id   TEXT,
    actor_id   TEXT,
    employee_id TEXT,
    instance_id TEXT,
    workdir    TEXT,
    mode       TEXT,
    text       TEXT NOT NULL,
    source     TEXT NOT NULL,
    from_bot   TEXT,
    user_id    TEXT,
    attachments TEXT,
    observability TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat_time
    ON messages(chat_id, timestamp DESC)`,
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
    id                TEXT PRIMARY KEY,
    tenant            TEXT NOT NULL,
    entry_id          TEXT NOT NULL,
    channel           TEXT NOT NULL,
    actor_id          TEXT NOT NULL,
    chat_id           TEXT NOT NULL,
    employee_id       TEXT NOT NULL,
    instance_id       TEXT NOT NULL,
    workdir           TEXT NOT NULL,
    sdk_session_scope TEXT NOT NULL,
    mode              TEXT NOT NULL,
    title             TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    archived_at       INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_sessions_lookup
    ON conversation_sessions(tenant, entry_id, actor_id, employee_id, chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_sessions_updated
    ON conversation_sessions(tenant, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS workflow_threads (
    id                TEXT PRIMARY KEY,
    tenant            TEXT NOT NULL,
    session_id        TEXT NOT NULL,
    parent_session_id TEXT,
    entry_id          TEXT NOT NULL,
    actor_id          TEXT NOT NULL,
    owner_employee_id TEXT NOT NULL,
    state             TEXT NOT NULL,
    participants      TEXT NOT NULL,
    handoffs          TEXT NOT NULL,
    summary           TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_threads_tenant_actor
    ON workflow_threads(tenant, actor_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS runtime_events (
    id          TEXT PRIMARY KEY,
    tenant      TEXT,
    session_id  TEXT,
    chat_id     TEXT NOT NULL,
    actor_id    TEXT,
    employee_id TEXT,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    at          INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_events_session_time
    ON runtime_events(session_id, at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_events_tenant_time
    ON runtime_events(tenant, at DESC)`,
  `CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_name TEXT NOT NULL,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(bot_name, date)
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    bot_name       TEXT NOT NULL,
    schedule_type  TEXT NOT NULL CHECK(schedule_type IN ('cron', 'interval', 'once')),
    schedule_value TEXT NOT NULL,
    prompt         TEXT NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    last_run_at    INTEGER,
    next_run_at    INTEGER,
    run_count      INTEGER NOT NULL DEFAULT 0,
    entry_agent    TEXT
  )`,
];

interface RuntimeSessionRow {
  id: string;
  tenant: string;
  entry_id: string;
  channel: string;
  actor_id: string;
  chat_id: string;
  employee_id: string;
  instance_id: string;
  workdir: string;
  sdk_session_scope: string;
  mode: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

interface RuntimeSessionSummaryRow extends RuntimeSessionRow {
  message_count: number;
  last_message_at: number;
  preview: string;
}

interface RuntimeMessageRow {
  id: string;
  chat_id: string;
  session_id: string | null;
  timestamp: number;
  bot_name: string | null;
  tenant: string | null;
  entry_id: string | null;
  actor_id: string | null;
  employee_id: string | null;
  instance_id: string | null;
  workdir: string | null;
  mode: string | null;
  text: string;
  source: string;
  from_bot: string | null;
  user_id: string | null;
  observability: string | null;
}

interface WorkflowThreadRow {
  id: string;
  tenant: string;
  session_id: string;
  parent_session_id: string | null;
  entry_id: string;
  actor_id: string;
  owner_employee_id: string;
  state: string;
  participants: string;
  handoffs: string;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

interface RuntimeEventRow {
  id: string;
  tenant: string | null;
  session_id: string | null;
  chat_id: string;
  actor_id: string | null;
  employee_id: string | null;
  type: string;
  payload: string;
  at: number;
}

function parseJsonArray<T>(value: string, guard: (item: unknown) => item is T): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(guard);
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseObservability(value: string | null): AgentObservability | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as AgentObservability;
  } catch {
    return undefined;
  }
}

function isRuntimeEventType(value: string): value is RuntimeEventType {
  return value === 'user_message'
    || value === 'routing_decision'
    || value === 'agent_message'
    || value === 'tool_call_started'
    || value === 'tool_call_completed'
    || value === 'handoff_requested'
    || value === 'memory_op'
    || value === 'business_artifact'
    || value === 'error';
}

function isWorkflowParticipant(item: unknown): item is WorkflowParticipant {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<WorkflowParticipant>;
  return typeof candidate.employeeId === 'string'
    && typeof candidate.instanceId === 'string'
    && (candidate.role === 'owner' || candidate.role === 'participant' || candidate.role === 'observer')
    && typeof candidate.joinedAt === 'number';
}

function isWorkflowHandoffEvent(item: unknown): item is WorkflowHandoffEvent {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<WorkflowHandoffEvent>;
  return typeof candidate.fromEmployeeId === 'string'
    && typeof candidate.toEmployeeId === 'string'
    && (candidate.reason === undefined || typeof candidate.reason === 'string')
    && (candidate.status === 'requested' || candidate.status === 'accepted' || candidate.status === 'completed' || candidate.status === 'failed')
    && typeof candidate.at === 'number';
}

function mapWorkflowThreadRow(row: WorkflowThreadRow): WorkflowThread {
  return {
    id: row.id,
    tenant: row.tenant,
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id ?? undefined,
    entryId: row.entry_id,
    actorId: row.actor_id,
    ownerEmployeeId: row.owner_employee_id,
    state: row.state as WorkflowThreadState,
    participants: parseJsonArray(row.participants, isWorkflowParticipant),
    handoffs: parseJsonArray(row.handoffs, isWorkflowHandoffEvent),
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRuntimeSessionRow(row: RuntimeSessionRow): ConversationSession {
  return {
    id: row.id,
    tenant: row.tenant,
    entryId: row.entry_id,
    channel: row.channel as EntryChannel,
    actorId: row.actor_id,
    chatId: row.chat_id,
    employeeId: row.employee_id,
    instanceId: row.instance_id,
    workdir: row.workdir,
    sdkSessionScope: row.sdk_session_scope,
    mode: row.mode as ConversationMode,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

function mapRuntimeMessageRow(row: RuntimeMessageRow): PersistedMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    sessionId: row.session_id ?? undefined,
    timestamp: row.timestamp,
    botName: row.bot_name ?? undefined,
    tenant: row.tenant ?? undefined,
    entryId: row.entry_id ?? undefined,
    actorId: row.actor_id ?? undefined,
    employeeId: row.employee_id ?? undefined,
    instanceId: row.instance_id ?? undefined,
    workdir: row.workdir ?? undefined,
    mode: row.mode as ConversationMode | undefined,
    text: row.text,
    source: row.source as PersistedMessage['source'],
    fromBotName: row.from_bot ?? undefined,
    userId: row.user_id ?? undefined,
    observability: parseObservability(row.observability),
  };
}

function mapRuntimeEventRow(row: RuntimeEventRow): RuntimeEvent {
  return {
    id: row.id,
    tenant: row.tenant ?? undefined,
    sessionId: row.session_id ?? undefined,
    chatId: row.chat_id,
    actorId: row.actor_id ?? undefined,
    employeeId: row.employee_id ?? undefined,
    type: isRuntimeEventType(row.type) ? row.type : 'error',
    payload: parseJsonRecord(row.payload),
    at: row.at,
  };
}

/**
 * Minimal SQLite store for chat message history.
 * Used by Web UI to browse per-chat transcripts across restarts.
 */
export class MessageStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    const abs = resolve(process.cwd(), path);
    mkdirSync(dirname(abs), { recursive: true });
    const fresh = !existsSync(abs);
    this.db = new Database(abs);
    this.db.pragma('journal_mode = WAL');
    for (const stmt of SCHEMA_STATEMENTS) {
      this.db.prepare(stmt).run();
    }
    this.migrate();
    if (fresh) {
      logger.info({ path: abs }, 'MessageStore created');
    }
  }

  private migrate(): void {
    const cols = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    const migrations = [
      { col: 'session_id', def: 'TEXT' },
      { col: 'user_id', def: 'TEXT' },
      { col: 'attachments', def: 'TEXT' },
      { col: 'tenant', def: 'TEXT' },
      { col: 'entry_id', def: 'TEXT' },
      { col: 'actor_id', def: 'TEXT' },
      { col: 'employee_id', def: 'TEXT' },
      { col: 'instance_id', def: 'TEXT' },
      { col: 'workdir', def: 'TEXT' },
      { col: 'mode', def: 'TEXT' },
      { col: 'observability', def: 'TEXT' },
    ];
    // Separate migration for scheduled_tasks (different table)
    const taskCols = this.db.pragma('table_info(scheduled_tasks)') as Array<{ name: string }>;
    const taskExisting = new Set(taskCols.map((c) => c.name));
    const taskMigrations = [
      { col: 'entry_agent', def: 'TEXT' },
    ];
    for (const m of taskMigrations) {
      if (!taskExisting.has(m.col)) {
        this.db.pragma(`ALTER TABLE scheduled_tasks ADD COLUMN ${m.col} ${m.def}`);
        logger.info({ column: m.col }, 'Migration: added scheduled_tasks column');
      }
    }
    for (const m of migrations) {
      if (!existing.has(m.col)) {
        this.db.prepare(`ALTER TABLE messages ADD COLUMN ${m.col} ${m.def}`).run();
        logger.info({ column: m.col }, 'Migration: added column');
      }
    }
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_session_time
      ON messages(session_id, timestamp DESC)`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS runtime_events (
      id          TEXT PRIMARY KEY,
      tenant      TEXT,
      session_id  TEXT,
      chat_id     TEXT NOT NULL,
      actor_id    TEXT,
      employee_id TEXT,
      type        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      at          INTEGER NOT NULL
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_runtime_events_session_time
      ON runtime_events(session_id, at ASC)`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_runtime_events_tenant_time
      ON runtime_events(tenant, at DESC)`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS conversation_sessions (
      id                TEXT PRIMARY KEY,
      tenant            TEXT NOT NULL,
      entry_id          TEXT NOT NULL,
      channel           TEXT NOT NULL,
      actor_id          TEXT NOT NULL,
      chat_id           TEXT NOT NULL,
      employee_id       TEXT NOT NULL,
      instance_id       TEXT NOT NULL,
      workdir           TEXT NOT NULL,
      sdk_session_scope TEXT NOT NULL,
      mode              TEXT NOT NULL,
      title             TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      archived_at       INTEGER
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_conversation_sessions_lookup
      ON conversation_sessions(tenant, entry_id, actor_id, employee_id, chat_id)`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_conversation_sessions_updated
      ON conversation_sessions(tenant, updated_at DESC)`).run();
  }

  insert(msg: PersistedMessage): void {
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO messages
            (id, chat_id, session_id, timestamp, bot_name, tenant, entry_id, actor_id, employee_id, instance_id, workdir, mode, text, source, from_bot, user_id, observability)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          msg.id,
          msg.chatId,
          msg.sessionId ?? null,
          msg.timestamp,
          msg.botName ?? null,
          msg.tenant ?? null,
          msg.entryId ?? null,
          msg.actorId ?? null,
          msg.employeeId ?? null,
          msg.instanceId ?? null,
          msg.workdir ?? null,
          msg.mode ?? null,
          msg.text,
          msg.source,
          msg.fromBotName ?? null,
          msg.userId ?? null,
          msg.observability ? JSON.stringify(msg.observability) : null,
        );
    } catch (err) {
      logger.warn({ err, msg }, 'MessageStore insert failed');
    }
  }

  insertRuntimeEvent(event: RuntimeEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO runtime_events
          (id, tenant, session_id, chat_id, actor_id, employee_id, type, payload, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.tenant ?? null,
        event.sessionId ?? null,
        event.chatId,
        event.actorId ?? null,
        event.employeeId ?? null,
        event.type,
        JSON.stringify(event.payload),
        event.at,
      );
  }

  listRuntimeEvents(filter: RuntimeEventFilter = {}): RuntimeEvent[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.tenant) {
      where.push('tenant = ?');
      params.push(filter.tenant);
    }
    if (filter.sessionId) {
      where.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.chatId) {
      where.push('chat_id = ?');
      params.push(filter.chatId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(1000, filter.limit ?? 200));
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, tenant, session_id, chat_id, actor_id, employee_id, type, payload, at
         FROM runtime_events
         ${whereSql}
         ORDER BY at ASC, id ASC
         LIMIT ?`,
      )
      .all(...params) as RuntimeEventRow[];
    return rows.map(mapRuntimeEventRow);
  }

  listChats(botName?: string): ChatSummary[] {
    const where = botName ? 'WHERE bot_name = ?' : '';
    const params: string[] = botName ? [botName] : [];
    const rows = this.db
      .prepare(
        `SELECT chat_id, bot_name, MAX(timestamp) AS last_ts, COUNT(*) AS cnt
         FROM messages
         ${where}
         GROUP BY chat_id
         ORDER BY last_ts DESC`,
      )
      .all(...params) as Array<{ chat_id: string; bot_name: string; last_ts: number; cnt: number }>;
    return rows.map((r) => ({
      chatId: r.chat_id,
      botName: r.bot_name ?? '',
      lastMessageAt: r.last_ts,
      messageCount: r.cnt,
    }));
  }

  listMessages(chatId: string, limit = 100): PersistedMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id, session_id, timestamp, bot_name, tenant, entry_id, actor_id, employee_id, instance_id, workdir, mode, text, source, from_bot, user_id, observability
         FROM messages
         WHERE chat_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(chatId, limit) as Array<{
      id: string;
      chat_id: string;
      session_id: string | null;
      timestamp: number;
      bot_name: string | null;
      tenant: string | null;
      entry_id: string | null;
      actor_id: string | null;
      employee_id: string | null;
      instance_id: string | null;
      workdir: string | null;
      mode: string | null;
      text: string;
      source: string;
      from_bot: string | null;
      user_id: string | null;
      observability: string | null;
    }>;
    return rows
      .map((r) => ({
        id: r.id,
        chatId: r.chat_id,
        sessionId: r.session_id ?? undefined,
        timestamp: r.timestamp,
        botName: r.bot_name ?? undefined,
        tenant: r.tenant ?? undefined,
        entryId: r.entry_id ?? undefined,
        actorId: r.actor_id ?? undefined,
        employeeId: r.employee_id ?? undefined,
        instanceId: r.instance_id ?? undefined,
        workdir: r.workdir ?? undefined,
        mode: r.mode as ConversationMode | undefined,
        text: r.text,
        source: r.source as PersistedMessage['source'],
        fromBotName: r.from_bot ?? undefined,
        userId: r.user_id ?? undefined,
        observability: parseObservability(r.observability),
      }))
      .reverse();
  }

  upsertConversationSession(session: ConversationSession): void {
    this.db
      .prepare(
        `INSERT INTO conversation_sessions
          (id, tenant, entry_id, channel, actor_id, chat_id, employee_id, instance_id, workdir, sdk_session_scope, mode, title, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant = excluded.tenant,
           entry_id = excluded.entry_id,
           channel = excluded.channel,
           actor_id = excluded.actor_id,
           chat_id = excluded.chat_id,
           employee_id = excluded.employee_id,
           instance_id = excluded.instance_id,
           workdir = excluded.workdir,
           sdk_session_scope = excluded.sdk_session_scope,
           mode = excluded.mode,
           title = COALESCE(excluded.title, conversation_sessions.title),
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at`,
      )
      .run(
        session.id,
        session.tenant,
        session.entryId,
        session.channel,
        session.actorId,
        session.chatId,
        session.employeeId,
        session.instanceId,
        session.workdir,
        session.sdkSessionScope,
        session.mode,
        session.title ?? null,
        session.createdAt,
        session.updatedAt,
        session.archivedAt ?? null,
      );
  }

  getRuntimeSession(sessionId: string): ConversationSession | null {
    const row = this.db
      .prepare(
        `SELECT id, tenant, entry_id, channel, actor_id, chat_id, employee_id, instance_id, workdir, sdk_session_scope, mode, title, created_at, updated_at, archived_at
         FROM conversation_sessions
         WHERE id = ?`,
      )
      .get(sessionId) as RuntimeSessionRow | undefined;
    return row ? mapRuntimeSessionRow(row) : null;
  }

  archiveRuntimeSession(sessionId: string, archivedAt = Date.now()): ConversationSession | null {
    const existing = this.getRuntimeSession(sessionId);
    if (!existing) return null;

    this.db
      .prepare(
        `UPDATE conversation_sessions
         SET archived_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(archivedAt, archivedAt, sessionId);

    return {
      ...existing,
      updatedAt: archivedAt,
      archivedAt,
    };
  }

  upsertWorkflowThread(thread: WorkflowThread): void {
    this.db
      .prepare(
        `INSERT INTO workflow_threads
          (id, tenant, session_id, parent_session_id, entry_id, actor_id, owner_employee_id, state, participants, handoffs, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant = excluded.tenant,
           session_id = excluded.session_id,
           parent_session_id = excluded.parent_session_id,
           entry_id = excluded.entry_id,
           actor_id = excluded.actor_id,
           owner_employee_id = excluded.owner_employee_id,
           state = excluded.state,
           participants = excluded.participants,
           handoffs = excluded.handoffs,
           summary = excluded.summary,
           updated_at = excluded.updated_at`,
      )
      .run(
        thread.id,
        thread.tenant,
        thread.sessionId,
        thread.parentSessionId ?? null,
        thread.entryId,
        thread.actorId,
        thread.ownerEmployeeId,
        thread.state,
        JSON.stringify(thread.participants),
        JSON.stringify(thread.handoffs),
        thread.summary ?? null,
        thread.createdAt,
        thread.updatedAt,
      );
  }

  getWorkflowThread(threadId: string): WorkflowThread | null {
    const row = this.db
      .prepare(
        `SELECT id, tenant, session_id, parent_session_id, entry_id, actor_id, owner_employee_id, state, participants, handoffs, summary, created_at, updated_at
         FROM workflow_threads
         WHERE id = ?`,
      )
      .get(threadId) as WorkflowThreadRow | undefined;
    return row ? mapWorkflowThreadRow(row) : null;
  }

  listWorkflowThreads(filter: WorkflowThreadFilter = {}): WorkflowThread[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.tenant) {
      where.push('tenant = ?');
      params.push(filter.tenant);
    }
    if (filter.actorId) {
      where.push('actor_id = ?');
      params.push(filter.actorId);
    }
    if (filter.state) {
      where.push('state = ?');
      params.push(filter.state);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, tenant, session_id, parent_session_id, entry_id, actor_id, owner_employee_id, state, participants, handoffs, summary, created_at, updated_at
         FROM workflow_threads
         ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(...params) as WorkflowThreadRow[];
    return rows.map(mapWorkflowThreadRow);
  }

  appendWorkflowHandoff(threadId: string, handoff: WorkflowHandoffEvent, participant?: WorkflowParticipant): WorkflowThread | null {
    const existing = this.getWorkflowThread(threadId);
    if (!existing) return null;
    const participants = participant && !existing.participants.some((item) => item.employeeId === participant.employeeId)
      ? [...existing.participants, participant]
      : existing.participants;
    const next: WorkflowThread = {
      ...existing,
      participants,
      handoffs: [...existing.handoffs, handoff],
      state: handoff.status === 'failed' ? existing.state : 'open',
      updatedAt: handoff.at,
    };
    this.upsertWorkflowThread(next);
    return next;
  }

  listRuntimeSessions(filter: RuntimeSessionFilter = {}): RuntimeSessionSummary[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.tenant) {
      where.push('s.tenant = ?');
      params.push(filter.tenant);
    }
    if (filter.entryId) {
      where.push('s.entry_id = ?');
      params.push(filter.entryId);
    }
    if (filter.actorId) {
      where.push('s.actor_id = ?');
      params.push(filter.actorId);
    }
    if (filter.employeeId) {
      where.push('s.employee_id = ?');
      params.push(filter.employeeId);
    }
    if (filter.mode) {
      where.push('s.mode = ?');
      params.push(filter.mode);
    }
    if (!filter.includeArchived) {
      where.push('s.archived_at IS NULL');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    const offset = Math.max(0, filter.offset ?? 0);
    params.push(limit);
    params.push(offset);

    const rows = this.db
      .prepare(
        `SELECT
           s.id, s.tenant, s.entry_id, s.channel, s.actor_id, s.chat_id, s.employee_id, s.instance_id,
           s.workdir, s.sdk_session_scope, s.mode, s.title, s.created_at, s.updated_at, s.archived_at,
           COUNT(m.id) AS message_count,
           COALESCE(MAX(m.timestamp), s.updated_at) AS last_message_at,
           COALESCE((
             SELECT text FROM messages recent
             WHERE recent.session_id = s.id
             ORDER BY recent.timestamp DESC
             LIMIT 1
           ), '') AS preview
         FROM conversation_sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         ${whereSql}
         GROUP BY s.id
         ORDER BY last_message_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params) as RuntimeSessionSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      tenant: row.tenant,
      entryId: row.entry_id,
      channel: row.channel as EntryChannel,
      actorId: row.actor_id,
      chatId: row.chat_id,
      employeeId: row.employee_id,
      instanceId: row.instance_id,
      workdir: row.workdir,
      sdkSessionScope: row.sdk_session_scope,
      mode: row.mode as ConversationMode,
      title: row.title ?? undefined,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      preview: row.preview,
      archivedAt: row.archived_at ?? undefined,
    }));
  }

  listMessagesForSession(sessionId: string, limit = 100): PersistedMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id, session_id, timestamp, bot_name, tenant, entry_id, actor_id, employee_id, instance_id, workdir, mode, text, source, from_bot, user_id, observability
         FROM messages
         WHERE session_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as RuntimeMessageRow[];

    return rows.map(mapRuntimeMessageRow).reverse();
  }

  getMessagesForChat(
    chatId: string,
    limit: number = 50,
  ): Array<{ text: string; source: string; timestamp: number }> {
    return this.db
      .prepare(
        'SELECT text, source, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?',
      )
      .all(chatId, limit) as Array<{
      text: string;
      source: string;
      timestamp: number;
    }>;
  }

  /** Delete all stored messages. Returns the number of rows removed. */
  clearAll(): number {
    try {
      const countRow = this.db
        .prepare(`SELECT COUNT(*) AS c FROM messages`)
        .get() as { c: number };
      this.db.prepare(`DELETE FROM messages`).run();
      return countRow.c;
    } catch (err) {
      logger.warn({ err }, 'MessageStore clearAll failed');
      return 0;
    }
  }

  /* ── Scheduled tasks CRUD ──────────────────────────────── */

  private static mapTaskRow(r: {
    id: string;
    name: string;
    bot_name: string;
    schedule_type: string;
    schedule_value: string;
    prompt: string;
    enabled: number;
    created_at: number;
    last_run_at: number | null;
    next_run_at: number | null;
    run_count: number;
    entry_agent?: string | null;
  }): ScheduledTask {
    return {
      id: r.id,
      name: r.name,
      botName: r.bot_name,
      scheduleType: r.schedule_type as ScheduleType,
      scheduleValue: r.schedule_value,
      prompt: r.prompt,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      lastRunAt: r.last_run_at,
      nextRunAt: r.next_run_at,
      runCount: r.run_count,
      entryAgent: r.entry_agent ?? undefined,
    };
  }

  createTask(task: CreateTaskInput): ScheduledTask {
    const id = crypto.randomUUID();
    const now = Date.now();
    const nextRunAt = computeInitialNextRun(task);
    const enabled = task.enabled !== false;

    this.db
      .prepare(
        `INSERT INTO scheduled_tasks
          (id, name, bot_name, schedule_type, schedule_value, prompt, enabled, created_at, next_run_at, entry_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        task.name,
        task.botName,
        task.scheduleType,
        task.scheduleValue,
        task.prompt,
        enabled ? 1 : 0,
        now,
        nextRunAt,
        task.entryAgent ?? null,
      );

    return {
      id,
      name: task.name,
      botName: task.botName,
      scheduleType: task.scheduleType,
      scheduleValue: task.scheduleValue,
      prompt: task.prompt,
      enabled,
      createdAt: now,
      lastRunAt: null,
      nextRunAt,
      runCount: 0,
      entryAgent: task.entryAgent,
    };
  }

  listTasks(): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, bot_name, schedule_type, schedule_value, prompt, enabled,
                created_at, last_run_at, next_run_at, run_count, entry_agent
         FROM scheduled_tasks
         ORDER BY created_at DESC`,
      )
      .all() as Array<Parameters<typeof MessageStore.mapTaskRow>[0]>;
    return rows.map(MessageStore.mapTaskRow);
  }

  getTask(id: string): ScheduledTask | null {
    const row = this.db
      .prepare(
        `SELECT id, name, bot_name, schedule_type, schedule_value, prompt, enabled,
                created_at, last_run_at, next_run_at, run_count, entry_agent
         FROM scheduled_tasks WHERE id = ?`,
      )
      .get(id) as Parameters<typeof MessageStore.mapTaskRow>[0] | undefined;
    return row ? MessageStore.mapTaskRow(row) : null;
  }

  updateTask(id: string, patch: Partial<ScheduledTask>): ScheduledTask | null {
    const existing = this.getTask(id);
    if (!existing) return null;

    const ALLOWED_COLUMNS = new Set([
      'name', 'bot_name', 'schedule_type', 'schedule_value',
      'prompt', 'enabled', 'next_run_at', 'last_run_at', 'entry_agent',
      'run_count',
    ]);
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!ALLOWED_COLUMNS.has(col)) continue;
      sets.push(`${col} = ?`);
      values.push(key === 'enabled' ? (val ? 1 : 0) : val);
    }

    if (sets.length === 0) return existing;

    values.push(id);
    this.db
      .prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getTask(id);
  }

  deleteTask(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM scheduled_tasks WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /* ── Daily summaries ──────────────────────────────────── */

  saveDailySummary(botName: string, date: string, content: string): void {
    this.db.prepare('INSERT OR REPLACE INTO daily_summaries (bot_name, date, content) VALUES (?, ?, ?)').run(botName, date, content);
  }

  getDailySummary(botName: string, date: string): string | null {
    const row = this.db.prepare('SELECT content FROM daily_summaries WHERE bot_name = ? AND date = ?').get(botName, date);
    return row ? (row as { content: string }).content : null;
  }

  listDailySummaries(botName: string, limit: number = 3): Array<{ date: string; content: string }> {
    return this.db.prepare('SELECT date, content FROM daily_summaries WHERE bot_name = ? AND date != \'__heartbeat__\' ORDER BY date DESC LIMIT ?').all(botName, limit) as Array<{ date: string; content: string }>;
  }

  getMessagesSince(sinceTimestamp: number): Array<{ bot_name: string; source: string; text: string; timestamp: number }> {
    return this.db.prepare(
      "SELECT bot_name, source, text, timestamp FROM messages WHERE timestamp >= ? ORDER BY timestamp ASC",
    ).all(sinceTimestamp) as Array<{ bot_name: string; source: string; text: string; timestamp: number }>;
  }

  /** Get messages for a chat after a given timestamp (for incremental history loading). */
  getMessagesAfter(chatId: string, afterTimestamp: number, limit: number = 50): Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; observability: string | null }> {
    return this.db.prepare(
      `SELECT id, chat_id, timestamp, bot_name, text, source, from_bot, user_id, observability
       FROM messages
       WHERE chat_id = ? AND timestamp > ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    ).all(chatId, afterTimestamp, limit) as Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; observability: string | null }>;
  }

  /** Get messages before a given timestamp (for load-more / backward pagination). */
  getMessagesBefore(chatId: string, beforeTimestamp: number, limit: number = 50): Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; attachments: string | null; observability: string | null }> {
    return this.db.prepare(
      `SELECT id, chat_id, timestamp, bot_name, text, source, from_bot, user_id, attachments, observability
       FROM messages
       WHERE chat_id = ? AND timestamp < ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    ).all(chatId, beforeTimestamp, limit).reverse() as Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; attachments: string | null; observability: string | null }>;
  }

  /** Get the most recent messages across all chats. */
  getRecentMessages(limit: number = 50): Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; observability: string | null }> {
    return this.db.prepare(
      `SELECT id, chat_id, timestamp, bot_name, text, source, from_bot, user_id, observability
       FROM messages
       ORDER BY timestamp DESC
       LIMIT ?`,
    ).all(limit).reverse() as Array<{ id: string; chat_id: string; timestamp: number; bot_name: string | null; text: string; source: string; from_bot: string | null; user_id: string | null; observability: string | null }>;
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      logger.debug({ err }, 'MessageStore close error');
    }
  }
}
