import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppServerMgr } from '../src/app-server.js';

// The demo med_crm skill is declared as a JSON-RPC server (tools.json `server`).
// This proves the real server.py answers tool calls over the AppServerMgr
// protocol against the per-tenant SQLite DB (passed via env).
const SKILL_SRC = join(process.cwd(), 'corp/acme/.claude/skills/med_crm');

describe('med_crm JSON-RPC server', () => {
  let root: string;
  let skillDir: string;
  let dbPath: string;
  const mgr = new AppServerMgr();

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'med-crm-server-'));
    skillDir = join(root, 'skill');
    cpSync(SKILL_SRC, skillDir, { recursive: true });
    dbPath = join(root, 'crm.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE bid_wins (id INTEGER PRIMARY KEY, hospital_id INTEGER, project_code TEXT,
        announcement_url TEXT, contract_url TEXT, contract_amount REAL, supplier TEXT,
        contract_no TEXT, publish_date TEXT, device_category TEXT, supplier_category TEXT,
        stage TEXT, created_at TEXT, updated_at TEXT);
      INSERT INTO bid_wins (id, hospital_id, project_code, contract_amount, supplier, publish_date, device_category, supplier_category, stage)
        VALUES (6428, 6428, '330382263180160000008-WZLCZB-2026-03047', 1618000, '杭州示例医疗器械有限公司', '2026-04-07', 'CT', 'self', 'result');
    `);
    db.close();
  });

  afterAll(() => {
    mgr.stopServer('med_crm');
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('starts server.py and answers search_bids over JSON-RPC against the tenant DB', async () => {
    await mgr.startServer('med_crm', {
      cwd: skillDir,
      entry: 'med_crm/server.py',
      python: 'python3',
      env: { ACME_CRM_DB: dbPath },
    });

    const result = (await mgr.call('med_crm', 'search_bids', { keyword: '杭州示例医疗' })) as {
      count: number;
      items: Array<{ project_code: string; supplier: string }>;
    };

    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.items[0].project_code).toContain('330382');
    expect(result.items[0].supplier).toContain('示例医疗');
  });
});
