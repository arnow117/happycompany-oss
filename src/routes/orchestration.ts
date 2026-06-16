import type { Hono } from 'hono';
import type { TraceStore, OrchestrationTrace } from '../orchestrator/trace-store.js';

export interface OrchestrationRoutesDeps {
  traceStore?: TraceStore;
}

export function registerOrchestrationRoutes(app: Hono, deps: OrchestrationRoutesDeps): void {
  app.get('/api/orchestration/traces', (c) => {
    if (!deps.traceStore) return c.json({ traces: [] });
    return c.json({ traces: deps.traceStore.list() });
  });

  app.post('/api/orchestration/traces/seed', async (c) => {
    if (!deps.traceStore) return c.json({ error: 'No trace store' }, 503);
    const body = await c.req.json<{ trace?: OrchestrationTrace }>();
    if (!body.trace) return c.json({ error: 'trace required' }, 400);
    deps.traceStore.save(body.trace);
    return c.json({ ok: true, id: body.trace.id });
  });
}
