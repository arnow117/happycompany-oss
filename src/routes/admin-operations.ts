import type { Hono } from 'hono';
import { initAnalytics, getSkillStats } from '../skill-analytics.js';
import type { MessageStore } from '../store.js';
import type { TaskScheduler } from '../scheduler.js';
import type { ScheduleType, CreateTaskInput } from '../scheduler.js';
import type { MemoryManager } from '../memory.js';

export interface AdminOperationsDeps {
  dataDir: string;
  store: MessageStore;
  scheduler?: TaskScheduler;
  memoryManager: MemoryManager;
}

export function registerAdminOperationsRoutes(app: Hono, deps: AdminOperationsDeps): void {
  // ── Compatibility Operations ─────────────────────────

  app.get('/api/admin/analytics/usage', (c) => {
    const days = Number.parseInt(c.req.query('days') ?? '7', 10);
    return c.json([{
      date: new Date().toISOString().slice(0, 10),
      days: Number.isFinite(days) ? days : 7,
      messages: 0,
      sessions: 0,
    }]);
  });

  app.get('/api/admin/analytics/chats/:chatId', (c) => {
    const chatId = c.req.param('chatId');
    const days = Number.parseInt(c.req.query('days') ?? '7', 10);
    return c.json({
      chatId,
      days: Number.isFinite(days) ? days : 7,
      messages: 0,
      sessions: 0,
    });
  });

  const scaffoldTypes = [
    { type: 'custom', label: 'Custom App', description: 'Create a custom tenant app scaffold.' },
    { type: 'tool', label: 'Tool App', description: 'Create a CLI tool app scaffold.' },
    { type: 'kb', label: 'Knowledge Base', description: 'Create a knowledge base scaffold.' },
  ];

  app.get('/api/admin/scaffold/types', (c) => c.json(scaffoldTypes));

  app.post('/api/admin/scaffold', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const type = typeof body.type === 'string' ? body.type.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!name || !type || !description) {
        return c.json({ error: 'name, type, and description are required' }, 400);
      }
      if (!scaffoldTypes.some((item) => item.type === type)) {
        return c.json({ error: `Unknown scaffold type: ${type}` }, 500);
      }
      return c.json({ name, type, description, created: true }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/admin/build/check', (c) => {
    return c.json({ available: false, reason: 'Build assistant is not configured in this environment.' });
  });

  app.post('/api/admin/build', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const wish = typeof body.wish === 'string' ? body.wish.trim() : '';
      if (!wish) return c.json({ error: 'wish is required' }, 400);
      return c.json({
        sessionId: `build-${Date.now()}`,
        status: 'queued',
      }, 202);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/admin/build/:sessionId/status', (c) => {
    return c.json({ error: `Build session not found: ${c.req.param('sessionId')}` }, 404);
  });

  app.post('/api/admin/build/:sessionId/publish', (c) => {
    return c.json({ error: `Build session not found: ${c.req.param('sessionId')}` }, 404);
  });

  app.get('/api/admin/insights', (c) => {
    return c.json([]);
  });

  app.post('/api/admin/insights/generate', async (c) => {
    try {
      await c.req.json();
      return c.json({ id: `insight-${Date.now()}`, status: 'queued' }, 202);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/admin/insights/:id/status', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.status !== 'string' || !body.status.trim()) {
        return c.json({ error: 'status is required' }, 400);
      }
      return c.json({ error: `Insight not found: ${c.req.param('id')}` }, 404);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  // ── Skills Analytics ─────────────────────────────────

  app.get('/api/admin/analytics/skills', (c) => {
    try {
      const stats = getSkillStats(deps.dataDir);
      return c.json(stats);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── Memory ───────────────────────────────────────────

  app.get('/api/admin/memory/:botName/sources', (c) => {
    const botName = c.req.param('botName');
    const tenant = c.req.query('tenant');
    const sources = deps.memoryManager.listSources(botName, tenant);
    return c.json({ data: sources });
  });

  app.get('/api/admin/memory/:botName/search', (c) => {
    const botName = c.req.param('botName');
    const tenant = c.req.query('tenant');
    const query = c.req.query('q') as string;
    if (!query) return c.json({ data: [] });
    const results = deps.memoryManager.searchMemory(botName, query, undefined, tenant);
    return c.json({ data: results });
  });

  app.get('/api/admin/memory/:botName/file', (c) => {
    const botName = c.req.param('botName');
    const tenant = c.req.query('tenant');
    const filePath = c.req.query('path') as string;
    const fromLine = c.req.query('fromLine') ? parseInt(c.req.query('fromLine') as string) : undefined;
    const lines = c.req.query('lines') ? parseInt(c.req.query('lines') as string) : undefined;
    try {
      const content = deps.memoryManager.readMemory(botName, filePath, fromLine, lines, tenant);
      return c.json({ data: content });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/admin/memory/:botName/file', async (c) => {
    const botName = c.req.param('botName');
    const tenant = c.req.query('tenant');
    try {
      const { path, content } = await c.req.json() as { path: string; content: string };
      deps.memoryManager.writeMemory(botName, path, content, tenant);
      return c.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  // ── Scheduler ────────────────────────────────────────

  const VALID_SCHEDULE_TYPES: ScheduleType[] = ['cron', 'interval', 'once'];

  app.get('/api/admin/scheduler/tasks', (c) => {
    try {
      return c.json(deps.store.listTasks());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.post('/api/admin/scheduler/tasks', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const { name, botName, scheduleType, scheduleValue, prompt } = body;
      if (!name || typeof name !== 'string') {
        return c.json({ error: 'name is required' }, 400);
      }
      if (!botName || typeof botName !== 'string') {
        return c.json({ error: 'botName is required' }, 400);
      }
      if (!scheduleType || !VALID_SCHEDULE_TYPES.includes(scheduleType as ScheduleType)) {
        return c.json({ error: `scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}` }, 400);
      }
      if (!scheduleValue || typeof scheduleValue !== 'string') {
        return c.json({ error: 'scheduleValue is required' }, 400);
      }
      if (!prompt || typeof prompt !== 'string') {
        return c.json({ error: 'prompt is required' }, 400);
      }
      const input: CreateTaskInput = {
        name,
        botName,
        scheduleType: scheduleType as ScheduleType,
        scheduleValue,
        prompt,
        enabled: body.enabled !== false,
      };
      const task = deps.store.createTask(input);
      return c.json(task);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.put('/api/admin/scheduler/tasks/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const body = await c.req.json() as Partial<Record<string, unknown>>;
      const task = deps.store.updateTask(id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        botName: typeof body.botName === 'string' ? body.botName : undefined,
        scheduleType: VALID_SCHEDULE_TYPES.includes(body.scheduleType as ScheduleType)
          ? body.scheduleType as ScheduleType : undefined,
        scheduleValue: typeof body.scheduleValue === 'string' ? body.scheduleValue : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      });
      if (!task) return c.json({ error: 'Task not found' }, 404);
      return c.json(task);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/api/admin/scheduler/tasks/:id', (c) => {
    const id = c.req.param('id');
    try {
      const deleted = deps.store.deleteTask(id);
      if (!deleted) return c.json({ error: 'Task not found' }, 404);
      return c.json({ deleted: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.post('/api/admin/scheduler/tasks/:id/trigger', async (c) => {
    const id = c.req.param('id');
    if (!deps.scheduler) {
      return c.json({ error: 'Scheduler not configured' }, 503);
    }
    try {
      const result = await deps.scheduler.triggerTask(id);
      if (!result.success) return c.json({ error: result.error }, 404);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  initAnalytics(deps.dataDir);
}
