import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerEnterprisePeopleRoutes } from '../src/routes/enterprise-people.js';

interface BoundPerson {
  userId: string;
  entryEmployee?: string;
  routingMode?: 'bound' | 'selector';
  visibleEmployees?: string[];
  role?: string;
  assistantId?: string;
}

describe('enterprise people routes', () => {
  let corpDir: string;
  let app: Hono;
  const employeeExists = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    corpDir = mkdtempSync(join(tmpdir(), 'enterprise-people-routes-'));
    app = new Hono();
    employeeExists.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(corpDir, { recursive: true, force: true });
  });

  it('syncs DingTalk people and lists them', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [
          { userInfo: { userId: 'u1', name: '赵六' } },
        ],
      }),
      employeeExists,
    });

    const syncRes = await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    expect(syncRes.status).toBe(200);
    expect(await syncRes.json()).toEqual({
      people: [expect.objectContaining({ userId: 'u1', name: '赵六', status: 'active' })],
      sync: { created: 1, updated: 0, inactive: 0, total: 1 },
    });

    const listRes = await app.request('/api/enterprise-people?tenant=acme');
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      people: [expect.objectContaining({ userId: 'u1', name: '赵六' })],
    });
  });

  it('binds a person to a role and entry employee through the legacy assistant field', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    const bindRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({ role: 'sales', assistantId: 'sales-zhaoliu' }),
    });

    expect(bindRes.status).toBe(200);
    expect(await bindRes.json()).toEqual({
      person: expect.objectContaining({
        userId: 'u1',
        role: 'sales',
        entryEmployee: 'sales-zhaoliu',
        routingMode: 'bound',
      }),
    });

    const listRes = await app.request('/api/enterprise-people?tenant=acme');
    const listBody = await listRes.json() as { people: BoundPerson[] };
    expect(listBody.people[0]).toEqual(expect.objectContaining({
      userId: 'u1',
      role: 'sales',
      entryEmployee: 'sales-zhaoliu',
    }));
  });

  it('clears role and entry employee bindings through the legacy assistant field', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({ role: 'sales', assistantId: 'sales-zhaoliu' }),
    });
    const clearRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({ role: null, assistantId: null }),
    });

    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json() as {
      person: { userId: string; role?: string; assistantId?: string; entryEmployee?: string };
    };
    expect(clearBody.person.userId).toBe('u1');
    expect(clearBody.person).not.toHaveProperty('role');
    expect(clearBody.person).not.toHaveProperty('assistantId');
    expect(clearBody.person).not.toHaveProperty('entryEmployee');

    const listRes = await app.request('/api/enterprise-people?tenant=acme');
    const listBody = await listRes.json() as { people: BoundPerson[] };
    expect(listBody.people[0]).not.toHaveProperty('role');
    expect(listBody.people[0]).not.toHaveProperty('entryEmployee');
  });

  it('binds entryEmployee with routingMode and visibleEmployees', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    const bindRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({
        entryEmployee: 'sales-zhangsan',
        routingMode: 'bound',
        visibleEmployees: ['sales-zhangsan', 'finance-wangwu'],
      }),
    });

    expect(bindRes.status).toBe(200);
    const body = await bindRes.json() as { person: BoundPerson };
    expect(body.person).toEqual(expect.objectContaining({
      userId: 'u1',
      entryEmployee: 'sales-zhangsan',
      routingMode: 'bound',
      visibleEmployees: ['sales-zhangsan', 'finance-wangwu'],
    }));

    const listRes = await app.request('/api/enterprise-people?tenant=acme');
    const listBody = await listRes.json() as { people: BoundPerson[] };
    expect(listBody.people[0]).toEqual(expect.objectContaining({
      entryEmployee: 'sales-zhangsan',
      routingMode: 'bound',
      visibleEmployees: ['sales-zhangsan', 'finance-wangwu'],
    }));
  });

  it('supports selector routing mode', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    const bindRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({
        entryEmployee: 'maintenance-lisi',
        routingMode: 'selector',
        visibleEmployees: ['maintenance-lisi', 'sales-zhangsan'],
      }),
    });

    expect(bindRes.status).toBe(200);
    const body = await bindRes.json() as { person: BoundPerson };
    expect(body.person.routingMode).toBe('selector');
  });

  it('clears entryEmployee/routingMode/visibleEmployees when entryEmployee is empty', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({
        entryEmployee: 'sales-zhangsan',
        routingMode: 'bound',
        visibleEmployees: ['sales-zhangsan'],
      }),
    });
    const clearRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({ entryEmployee: '' }),
    });

    expect(clearRes.status).toBe(200);
    const body = await clearRes.json() as { person: BoundPerson };
    expect(body.person).not.toHaveProperty('entryEmployee');
    expect(body.person).not.toHaveProperty('routingMode');
    expect(body.person).not.toHaveProperty('visibleEmployees');
  });

  it('migrates legacy people.json from assistantId/role to entryEmployee', async () => {
    const tenantDir = join(corpDir, 'acme');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(
      join(tenantDir, 'people.json'),
      JSON.stringify([
        {
          userId: 'u1',
          name: '赵六',
          status: 'active',
          createdAt: 1000,
          updatedAt: 1000,
          role: 'sales',
          assistantId: 'sales-zhaoliu',
        },
      ]),
      'utf-8',
    );

    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn(),
      employeeExists,
    });

    const listRes = await app.request('/api/enterprise-people?tenant=acme');
    const body = await listRes.json() as { people: BoundPerson[] };
    expect(body.people[0]).toEqual(expect.objectContaining({
      userId: 'u1',
      entryEmployee: 'sales-zhaoliu',
      routingMode: 'bound',
      visibleEmployees: [],
    }));
    expect(body.people[0]).not.toHaveProperty('assistantId');
    expect(body.people[0]).not.toHaveProperty('role');

    const onDisk = JSON.parse(readFileSync(join(tenantDir, 'people.json'), 'utf-8')) as BoundPerson[];
    expect(onDisk[0]?.entryEmployee).toBe('sales-zhaoliu');
    expect(onDisk[0]).not.toHaveProperty('assistantId');
  });

  it('rejects invalid tenant instead of falling back to acme', async () => {
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn(),
      employeeExists,
    });

    const res = await app.request('/api/enterprise-people?tenant=../acme');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'tenant must be lowercase alphanumeric (a-z, 0-9, -)',
    });
  });

  it('rejects bindings to employees outside the tenant employee set', async () => {
    employeeExists.mockReturnValue(false);
    registerEnterprisePeopleRoutes(app, {
      corpDir,
      runDws: vi.fn().mockResolvedValue({
        deptUserList: [{ userInfo: { userId: 'u1', name: '赵六' } }],
      }),
      employeeExists,
    });

    await app.request('/api/enterprise-people/sync?tenant=acme', { method: 'POST' });
    const bindRes = await app.request('/api/enterprise-people/u1/bind?tenant=acme', {
      method: 'POST',
      body: JSON.stringify({ entryEmployee: 'other-tenant-sales' }),
    });

    expect(bindRes.status).toBe(400);
    expect(await bindRes.json()).toEqual({
      error: 'Employee "other-tenant-sales" does not exist in tenant "acme"',
    });
  });
});
