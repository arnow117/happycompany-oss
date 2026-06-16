import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  EnterprisePeopleStore,
  normalizeDingTalkMembers,
  type EnterpriseDepartment,
} from '../enterprise-people.js';

const execFileAsync = promisify(execFile);

export type DwsRunner = (args: string[]) => Promise<unknown>;

export interface EnterprisePeopleRoutesDeps {
  corpDir: string;
  runDws?: DwsRunner;
  employeeExists?: (tenant: string, employeeId: string) => boolean;
}

class TenantInputError extends Error {}

function parseTenant(raw: string | undefined): string {
  if (!raw) throw new TenantInputError('tenant is required');
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) throw new TenantInputError('tenant must be lowercase alphanumeric (a-z, 0-9, -)');
  return raw;
}

function defaultEmployeeExists(corpDir: string, tenant: string, employeeId: string): boolean {
  const dir = path.join(corpDir, tenant, 'employees');
  if (!fs.existsSync(dir)) return false;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = path.join(dir, file);
    if (!fs.statSync(filePath).isFile()) continue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const id = raw.match(/^id:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim()
      ?? path.basename(file, path.extname(file));
    if (id === employeeId) return true;
  }
  return false;
}

function validateEmployeeBinding(
  tenant: string,
  body: { entryEmployee?: string; assistantId?: string | null; visibleEmployees?: string[] },
  employeeExists: (tenant: string, employeeId: string) => boolean,
): string | null {
  const ids = new Set<string>();
  if (body.entryEmployee) ids.add(body.entryEmployee);
  if (body.assistantId) ids.add(body.assistantId);
  for (const id of body.visibleEmployees ?? []) {
    if (id) ids.add(id);
  }
  for (const id of ids) {
    if (!employeeExists(tenant, id)) {
      return `Employee "${id}" does not exist in tenant "${tenant}"`;
    }
  }
  return null;
}

async function defaultRunDws(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync('dws', [...args, '--format', 'json'], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
  });
  return JSON.parse(stdout);
}

export function registerEnterprisePeopleRoutes(app: Hono, deps: EnterprisePeopleRoutesDeps): void {
  const store = new EnterprisePeopleStore(deps.corpDir);
  const runDws = deps.runDws ?? defaultRunDws;
  const employeeExists = deps.employeeExists ?? ((tenant, employeeId) => defaultEmployeeExists(deps.corpDir, tenant, employeeId));

  app.get('/api/enterprise-people', (c) => {
    try {
      const tenant = parseTenant(c.req.query('tenant'));
      return c.json({ people: store.list(tenant) });
    } catch (err) {
      if (err instanceof TenantInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  app.post('/api/enterprise-people/sync', async (c) => {
    let tenant: string;
    try {
      tenant = parseTenant(c.req.query('tenant'));
    } catch (err) {
      if (err instanceof TenantInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
    const deptId = c.req.query('deptId') || '1';
    const deptName = c.req.query('deptName') || '杭州示例医疗器械有限公司';
    const department: EnterpriseDepartment = { id: deptId, name: deptName };

    try {
      const payload = await runDws(['contact', 'dept', 'list-members', '--ids', deptId]);
      const incoming = normalizeDingTalkMembers(payload, department);
      const sync = store.sync(tenant, incoming);
      return c.json({ people: store.list(tenant), sync });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  app.post('/api/enterprise-people/:userId/bind', async (c) => {
    let tenant: string;
    try {
      tenant = parseTenant(c.req.query('tenant'));
    } catch (err) {
      if (err instanceof TenantInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
    const userId = c.req.param('userId');
    const body = await c.req.json<{
      role?: string | null;
      assistantId?: string | null;
      entryEmployee?: string;
      routingMode?: 'bound' | 'selector';
      visibleEmployees?: string[];
    }>();
    const validationError = validateEmployeeBinding(tenant, body, employeeExists);
    if (validationError) return c.json({ error: validationError }, 400);
    const person = store.bindAssistant(tenant, userId, {
      role: body.role,
      assistantId: body.assistantId,
      entryEmployee: body.entryEmployee,
      routingMode: body.routingMode,
      visibleEmployees: body.visibleEmployees,
    });
    if (!person) return c.json({ error: 'Person not found' }, 404);
    return c.json({ person });
  });
}
