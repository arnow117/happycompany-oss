import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────

export interface Contract {
  id: string;
  parentId: string | null;
  fromAgent: string;
  toAgent: string | null;
  task: string;
  status: 'pending' | 'active' | 'waiting' | 'done' | 'failed';
  result: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface CreateContractInput {
  id?: string;
  parentId?: string | null;
  fromAgent: string;
  toAgent?: string | null;
  task: string;
  status?: Contract['status'];
}

export interface RoutingDecision {
  id: string;
  contractId: string;
  method: 'keyword' | 'llm' | 'direct';
  candidates: string | null;
  chosen: string | null;
  reason: string | null;
  score: number | null;
  createdAt: number;
}

export interface CreateRoutingDecisionInput {
  id?: string;
  contractId: string;
  method: RoutingDecision['method'];
  candidates?: string[] | null;
  chosen?: string | null;
  reason?: string | null;
  score?: number | null;
}

// ── Constants ──────────────────────────────────────────────────────

const CONTRACT_COLUMNS = [
  'id', 'parent_id', 'from_agent', 'to_agent', 'task',
  'status', 'result', 'created_at', 'finished_at',
] as const;

const DECISION_COLUMNS = [
  'id', 'contract_id', 'method', 'candidates',
  'chosen', 'reason', 'score', 'created_at',
] as const;

const ACTIVE_STATUSES = new Set(['pending', 'active', 'waiting']);

// ── Schema ─────────────────────────────────────────────────────────

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS contracts (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT,
    from_agent  TEXT NOT NULL,
    to_agent    TEXT,
    task        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    result      TEXT,
    created_at  INTEGER NOT NULL,
    finished_at INTEGER,
    FOREIGN KEY (parent_id) REFERENCES contracts(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_parent
    ON contracts(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_status
    ON contracts(status)`,

  `CREATE TABLE IF NOT EXISTS routing_decisions (
    id          TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    method      TEXT NOT NULL,
    candidates  TEXT,
    chosen      TEXT,
    reason      TEXT,
    score       REAL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_contract
    ON routing_decisions(contract_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_created
    ON routing_decisions(created_at DESC)`,
];

// ── Row types ───────────────────────────────────────────────────────

interface ContractRow {
  id: string;
  parent_id: string | null;
  from_agent: string;
  to_agent: string | null;
  task: string;
  status: string;
  result: string | null;
  created_at: number;
  finished_at: number | null;
}

interface DecisionRow {
  id: string;
  contract_id: string;
  method: string;
  candidates: string | null;
  chosen: string | null;
  reason: string | null;
  score: number | null;
  created_at: number;
}

// ── Mappers ────────────────────────────────────────────────────────

function rowToContract(row: ContractRow): Contract {
  return {
    id: row.id,
    parentId: row.parent_id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    task: row.task,
    status: row.status as Contract['status'],
    result: row.result,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function rowToDecision(row: DecisionRow): RoutingDecision {
  return {
    id: row.id,
    contractId: row.contract_id,
    method: row.method as RoutingDecision['method'],
    candidates: row.candidates,
    chosen: row.chosen,
    reason: row.reason,
    score: row.score,
    createdAt: row.created_at,
  };
}

// ── ContractStore ──────────────────────────────────────────────────

export class ContractStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    for (const stmt of SCHEMA_STATEMENTS) {
      this.db.prepare(stmt).run();
    }
  }

  // ── Contracts ──────────────────────────────────────────────────

  create(input: CreateContractInput): Contract {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const status = input.status ?? 'pending';

    this.db
      .prepare(
        `INSERT INTO contracts
          (id, parent_id, from_agent, to_agent, task, status, result, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.parentId ?? null,
        input.fromAgent,
        input.toAgent ?? null,
        input.task,
        status,
        null,
        now,
        null,
      );

    return this.getById(id)!;
  }

  getById(id: string): Contract | undefined {
    const row = this.db
      .prepare(`SELECT ${CONTRACT_COLUMNS.join(', ')} FROM contracts WHERE id = ?`)
      .get(id) as ContractRow | undefined;
    return row ? rowToContract(row) : undefined;
  }

  getChildren(parentId: string): Contract[] {
    const rows = this.db
      .prepare(
        `SELECT ${CONTRACT_COLUMNS.join(', ')} FROM contracts WHERE parent_id = ? ORDER BY created_at ASC`,
      )
      .all(parentId) as ContractRow[];
    return rows.map(rowToContract);
  }

  getRoots(): Contract[] {
    const rows = this.db
      .prepare(
        `SELECT ${CONTRACT_COLUMNS.join(', ')} FROM contracts WHERE parent_id IS NULL ORDER BY created_at DESC`,
      )
      .all() as ContractRow[];
    return rows.map(rowToContract);
  }

  getActive(): Contract[] {
    const placeholders = [...ACTIVE_STATUSES].map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT ${CONTRACT_COLUMNS.join(', ')} FROM contracts WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...ACTIVE_STATUSES) as ContractRow[];
    return rows.map(rowToContract);
  }

  updateStatus(id: string, status: Contract['status'], result?: string): void {
    const now = Date.now();
    const isTerminal = status === 'done' || status === 'failed';

    this.db
      .prepare(
        `UPDATE contracts SET status = ?, result = ?, finished_at = ? WHERE id = ?`,
      )
      .run(status, result ?? null, isTerminal ? now : null, id);
  }

  assignTo(id: string, toAgent: string): void {
    this.db
      .prepare(`UPDATE contracts SET to_agent = ? WHERE id = ?`)
      .run(toAgent, id);
  }

  // ── Routing decisions ──────────────────────────────────────────

  recordDecision(input: CreateRoutingDecisionInput): RoutingDecision {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const candidates = input.candidates
      ? JSON.stringify(input.candidates)
      : null;

    this.db
      .prepare(
        `INSERT INTO routing_decisions
          (id, contract_id, method, candidates, chosen, reason, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.contractId,
        input.method,
        candidates,
        input.chosen ?? null,
        input.reason ?? null,
        input.score ?? null,
        now,
      );

    const row = this.db
      .prepare(`SELECT ${DECISION_COLUMNS.join(', ')} FROM routing_decisions WHERE id = ?`)
      .get(id) as DecisionRow;
    return rowToDecision(row);
  }

  getDecisions(contractId: string): RoutingDecision[] {
    const rows = this.db
      .prepare(
        `SELECT ${DECISION_COLUMNS.join(', ')} FROM routing_decisions WHERE contract_id = ? ORDER BY created_at ASC`,
      )
      .all(contractId) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  getRecentDecisions(limit: number): RoutingDecision[] {
    const rows = this.db
      .prepare(
        `SELECT ${DECISION_COLUMNS.join(', ')} FROM routing_decisions ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  // ── Agent workload ─────────────────────────────────────────────

  getAgentLoad(): { agentName: string; activeCount: number }[] {
    const placeholders = [...ACTIVE_STATUSES].map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT to_agent AS agentName, COUNT(*) AS activeCount
         FROM contracts
         WHERE to_agent IS NOT NULL AND status IN (${placeholders})
         GROUP BY to_agent
         ORDER BY activeCount DESC`,
      )
      .all(...ACTIVE_STATUSES) as Array<{ agentName: string; activeCount: number }>;
    return rows;
  }

  /** Returns agent workload including both active and total contract counts. */
  getAgentStats(): { agentName: string; activeCount: number; totalCount: number }[] {
    const placeholders = [...ACTIVE_STATUSES].map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT to_agent AS agentName,
                SUM(CASE WHEN status IN (${placeholders}) THEN 1 ELSE 0 END) AS activeCount,
                COUNT(*) AS totalCount
         FROM contracts
         WHERE to_agent IS NOT NULL
         GROUP BY to_agent
         ORDER BY activeCount DESC`,
      )
      .all(...ACTIVE_STATUSES) as Array<{ agentName: string; activeCount: number; totalCount: number }>;
    return rows;
  }

  /** Returns contracts filtered by a specific status. */
  getByStatus(status: Contract['status']): Contract[] {
    const rows = this.db
      .prepare(
        `SELECT ${CONTRACT_COLUMNS.join(', ')} FROM contracts WHERE status = ? ORDER BY created_at DESC`,
      )
      .all(status) as ContractRow[];
    return rows.map(rowToContract);
  }
}
