import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerCapabilityRoutes } from '../../src/routes/capabilities.js';
import { ToolRegistry } from '../../src/tool-registry.js';
import type { EmployeeCapabilityReport } from '../../src/capability-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = resolve(HERE, '../fixtures/agent-builder/sandbox-corp');

interface TestCtx {
  root: string;
  corpDir: string;
  app: Hono;
}

function setup(): TestCtx {
  const root = mkdtempSync(join(tmpdir(), 'capabilities-routes-'));
  const corpDir = join(root, 'corp');
  cpSync(SANDBOX, corpDir, { recursive: true });
  mkdirSync(join(corpDir, 'builder-demo', 'agents', 'maintenance-lisi'), { recursive: true });
  writeFileSync(join(corpDir, 'builder-demo', 'agents', 'maintenance-lisi', 'CLAUDE.md'), '# 维修李四\n');

  const toolRegistry = new ToolRegistry(corpDir);
  toolRegistry.scan();

  const app = new Hono();
  registerCapabilityRoutes(app, { corpDir, toolRegistry });
  return { root, corpDir, app };
}

describe('capability routes', () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('lists per-employee capability reports with skills, tools, workspace, and handoffs', async () => {
    const res = await ctx.app.request('/api/admin/capabilities?tenant=builder-demo');
    expect(res.status).toBe(200);
    const body = await res.json() as { employees: EmployeeCapabilityReport[] };
    const maintenance = body.employees.find((employee) => employee.employeeId === 'maintenance-lisi');

    expect(maintenance).toBeTruthy();
    expect(maintenance?.workspace.relative).toBe('agents/maintenance-lisi');
    expect(maintenance?.workspace.hasClaudeMd).toBe(true);
    expect(maintenance?.skills.map((skill) => skill.name)).toContain('med_crm');
    expect(maintenance?.tools.map((tool) => tool.name)).toContain('med_crm:list_maintenance');
    expect(maintenance?.tools.map((tool) => tool.name)).not.toContain('med_crm:delete_contract');
    expect(maintenance?.tools.every((tool) => tool.registered)).toBe(true);
    expect(maintenance?.tools.every((tool) => tool.allowed)).toBe(true);
    expect(maintenance?.handoffTargets.map((target) => target.employeeId)).toContain('finance-wangwu');
    expect(maintenance?.mcpBoundary.businessInterface).toBe('run_skill');
    expect(maintenance?.mcpBoundary.businessMcpDirectVisible).toBe(false);
  });

  it('returns one employee report and validates path params', async () => {
    const res = await ctx.app.request('/api/admin/capabilities/builder-demo/maintenance-lisi');
    expect(res.status).toBe(200);
    const body = await res.json() as { employee: EmployeeCapabilityReport };
    expect(body.employee.employeeId).toBe('maintenance-lisi');
    expect(body.employee.summary.toolCount).toBeGreaterThan(0);

    const missing = await ctx.app.request('/api/admin/capabilities/builder-demo/missing');
    expect(missing.status).toBe(404);

    const invalid = await ctx.app.request('/api/admin/capabilities/Builder/maintenance-lisi');
    expect(invalid.status).toBe(400);
  });
});
