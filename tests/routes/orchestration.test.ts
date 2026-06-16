import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { TraceStore, type OrchestrationTrace } from '../../src/orchestrator/trace-store.js';
import { registerOrchestrationRoutes } from '../../src/routes/orchestration.js';

const trace: OrchestrationTrace = {
  id: 'orchestration:test',
  entryAgent: 'sales-zhangsan',
  prompt: '客户设备要维修，谁一起处理？',
  success: true,
  summary: '销售张三交接给维修李四处理。',
  route: ['sales-zhangsan->maintenance-lisi'],
  handoffCount: 1,
  iterationCount: 1,
  steps: [{
    from: 'sales-zhangsan',
    to: 'maintenance-lisi',
    action: 'handoff',
    timestamp: 1,
    task: '处理维修诉求',
  }],
  startedAt: 1,
  finishedAt: 2,
};

describe('orchestration routes', () => {
  it('lists collaboration traces', async () => {
    const app = new Hono();
    const traceStore = new TraceStore();
    traceStore.save(trace);
    registerOrchestrationRoutes(app, { traceStore });

    const res = await app.request('/api/orchestration/traces');

    expect(res.status).toBe(200);
    const body = await res.json() as { traces: OrchestrationTrace[] };
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0]).toMatchObject({
      id: 'orchestration:test',
      handoffCount: 1,
      route: ['sales-zhangsan->maintenance-lisi'],
    });
  });
});
