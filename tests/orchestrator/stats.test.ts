import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector, InMemoryStatsStore } from '../../src/orchestrator/stats.js';

describe('StatsCollector', () => {
  let store: InMemoryStatsStore;
  let collector: StatsCollector;

  beforeEach(() => {
    store = new InMemoryStatsStore();
    collector = new StatsCollector(store);
  });

  it('records a token usage event', () => {
    collector.recordTokenUsage({
      agentId: 'sales-agent',
      inputTokens: 1500,
      outputTokens: 300,
      model: 'claude-sonnet-4-6',
    });
    const stats = store.getAgentStats('sales-agent');
    expect(stats.totalInputTokens).toBe(1500);
    expect(stats.totalOutputTokens).toBe(300);
    expect(stats.callCount).toBe(1);
  });

  it('accumulates across multiple calls', () => {
    collector.recordTokenUsage({ agentId: 'sales-agent', inputTokens: 1000, outputTokens: 200, model: 'claude-sonnet-4-6' });
    collector.recordTokenUsage({ agentId: 'sales-agent', inputTokens: 2000, outputTokens: 500, model: 'claude-sonnet-4-6' });
    const stats = store.getAgentStats('sales-agent');
    expect(stats.totalInputTokens).toBe(3000);
    expect(stats.totalOutputTokens).toBe(700);
    expect(stats.callCount).toBe(2);
  });

  it('records agent run event', () => {
    collector.recordAgentRun({ agentId: 'sales-agent', trigger: 'cron', success: true, durationMs: 5000 });
    collector.recordAgentRun({ agentId: 'sales-agent', trigger: 'event', success: false, durationMs: 3000, error: 'timeout' });
    const stats = store.getAgentStats('sales-agent');
    expect(stats.runCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.lastRunAt).toBeGreaterThan(0);
  });

  it('lists all agent stats', () => {
    collector.recordTokenUsage({ agentId: 'agent-1', inputTokens: 100, outputTokens: 50, model: 'model' });
    collector.recordTokenUsage({ agentId: 'agent-2', inputTokens: 200, outputTokens: 100, model: 'model' });
    const all = store.listAllAgentStats();
    expect(all).toHaveLength(2);
  });

  it('gets stats for date range', () => {
    const now = Date.now();
    collector.recordTokenUsage({ agentId: 'agent-1', inputTokens: 100, outputTokens: 50, model: 'model' });
    const range = store.getStatsForRange(now - 60000, now + 60000);
    expect(range).toHaveLength(1);
  });
});
