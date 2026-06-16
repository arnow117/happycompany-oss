import type { Hono } from 'hono';
import { join, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  listResolvedCards,
  readTierCard,
  writeTierCard,
  deleteTierCard,
  type KnowledgeTier,
} from '../knowledge-resolver.js';

interface PeopleEntry {
  userId: string;
  name: string;
  role?: string;
  departments?: Array<{ id: string; name: string }>;
}

export interface AdminKnowledgeDeps {
  corpDir: string;
}

export function registerAdminKnowledgeRoutes(app: Hono, deps: AdminKnowledgeDeps): void {
  function resolveTenantDir(tenantName: string): string | null {
    const dir = join(deps.corpDir, tenantName);
    // Accept any directory that exists under corp/ (tenant may or may not have app.json yet)
    if (!existsSync(dir)) return null;
    return dir;
  }

  function resolveGroupForEmployee(tenantDir: string, employeeId: string): string | undefined {
    const peoplePath = join(tenantDir, 'people.json');
    if (!existsSync(peoplePath)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(peoplePath, 'utf-8')) as PeopleEntry[];
      const person = raw.find((p) => p.userId === employeeId);
      return person?.role ?? person?.departments?.[0]?.name;
    } catch {
      return undefined;
    }
  }

  // List knowledge cards across all tiers (merged)
  app.get('/api/admin/knowledge', (c) => {
    const tenant = c.req.query('tenant');
    const employee = c.req.query('employee');

    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    const groupId = employee ? resolveGroupForEmployee(tenantDir, employee) : undefined;

    const result = listResolvedCards({ tenantDir, employeeId: employee, groupId });
    return c.json(result);
  });

  // List cards for a specific tier
  app.get('/api/admin/knowledge/:tier', (c) => {
    const tier = c.req.param('tier') as KnowledgeTier;
    const tenant = c.req.query('tenant');
    const tierId = c.req.query('tierId') ?? 'default';

    if (!['company', 'group', 'employee'].includes(tier)) {
      return c.json({ error: 'tier must be company, group, or employee' }, 400);
    }
    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    // Reuse resolver with only the requested tier
    const result = listResolvedCards({ tenantDir, ...(tier === 'employee' ? { employeeId: tierId } : {}), ...(tier === 'group' ? { groupId: tierId } : {}) });
    const tierCards = result.cards.filter((card) => card.tier === tier);
    return c.json({ cards: tierCards, tier, tierId });
  });

  // Read a single card
  app.get('/api/admin/knowledge/:tier/:name', (c) => {
    const tier = c.req.param('tier') as KnowledgeTier;
    const name = c.req.param('name');
    const tenant = c.req.query('tenant');
    const tierId = c.req.query('tierId') ?? 'default';

    if (!['company', 'group', 'employee'].includes(tier)) {
      return c.json({ error: 'tier must be company, group, or employee' }, 400);
    }
    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    const result = readTierCard(tenantDir, tier, tierId, name);
    if (!result) return c.json({ error: 'Card not found' }, 404);
    return c.json({ name, tier, tierId, ...result });
  });

  // Create (write) a card
  app.post('/api/admin/knowledge/:tier', async (c) => {
    const tier = c.req.param('tier') as KnowledgeTier;
    const tenant = c.req.query('tenant');
    const tierId = c.req.query('tierId') ?? 'default';
    const body = await c.req.json();
    const { name, content } = body as { name?: string; content?: string };

    if (!['company', 'group', 'employee'].includes(tier)) {
      return c.json({ error: 'tier must be company, group, or employee' }, 400);
    }
    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);
    if (!name || typeof content !== 'string') {
      return c.json({ error: 'name and content are required' }, 400);
    }

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    const safeName = basename(name);
    writeTierCard(tenantDir, tier, tierId, safeName, content);
    return c.json({ created: true, name: safeName, tier, tierId });
  });

  // Update a card (alias for POST)
  app.put('/api/admin/knowledge/:tier/:name', async (c) => {
    const tier = c.req.param('tier') as KnowledgeTier;
    const name = c.req.param('name');
    const tenant = c.req.query('tenant');
    const tierId = c.req.query('tierId') ?? 'default';
    const body = await c.req.json();
    const { content } = body as { content?: string };

    if (!['company', 'group', 'employee'].includes(tier)) {
      return c.json({ error: 'tier must be company, group, or employee' }, 400);
    }
    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);
    if (typeof content !== 'string') {
      return c.json({ error: 'content is required' }, 400);
    }

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    writeTierCard(tenantDir, tier, tierId, name, content);
    return c.json({ updated: true, name, tier, tierId });
  });

  // Delete a card
  app.delete('/api/admin/knowledge/:tier/:name', (c) => {
    const tier = c.req.param('tier') as KnowledgeTier;
    const name = c.req.param('name');
    const tenant = c.req.query('tenant');
    const tierId = c.req.query('tierId') ?? 'default';

    if (!['company', 'group', 'employee'].includes(tier)) {
      return c.json({ error: 'tier must be company, group, or employee' }, 400);
    }
    if (!tenant) return c.json({ error: 'tenant query parameter is required' }, 400);

    const tenantDir = resolveTenantDir(tenant);
    if (!tenantDir) return c.json({ error: `Unknown tenant: ${tenant}` }, 404);

    const deleted = deleteTierCard(tenantDir, tier, tierId, name);
    return c.json({ deleted });
  });
}
