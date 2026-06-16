import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppServerMgr } from '../app-server.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { RegisteredTool } from '../types.js';

export interface SkillServerDeps {
  appServerMgr: AppServerMgr;
  toolRegistry: ToolRegistry;
  corpDir: string;
}

/** Per-tenant CRM DB env for the med_crm skill (mirrors the CLI path's env). */
function crmDbEnv(corpDir: string, tenant: string): Record<string, string> | undefined {
  const tenantDb = path.join(corpDir, tenant, 'cdata', 'crm.db');
  const legacyDb = path.join(corpDir, 'acme', 'cdata', 'crm.db');
  const dbPath = existsSync(tenantDb) ? tenantDb : existsSync(legacyDb) ? legacyDb : undefined;
  return dbPath ? { ACME_CRM_DB: dbPath } : undefined;
}

/**
 * Lazily start the JSON-RPC server backing a `hasServer` tool and return the
 * tenant-scoped server key to pass to `AppServerMgr.call`. Server processes are
 * keyed per `tenant:skill` so multi-tenant DB paths never collide. If no server
 * manifest is found the key is still returned (call() then surfaces a clear
 * "not running" error).
 */
export async function ensureSkillServer(deps: SkillServerDeps, registered: RegisteredTool): Promise<string> {
  const key = `${registered.tenantName}:${registered.appName}`;
  if (deps.appServerMgr.getServerStatus(key).running) return key;

  const cfg = deps.toolRegistry
    .getSkillServers()
    .find((s) => s.tenantName === registered.tenantName && s.skillName === registered.skillName);
  if (!cfg) return key;

  await deps.appServerMgr.ensureServer(key, {
    cwd: cfg.cwd,
    entry: cfg.entry,
    python: cfg.python,
    env: registered.skillName === 'med_crm' ? crmDbEnv(deps.corpDir, registered.tenantName) : undefined,
  });
  return key;
}
