export interface TokenUsageEvent {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AgentRunEvent {
  agentId: string;
  trigger: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface AgentStats {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  runCount: number;
  failureCount: number;
  lastRunAt: number;
}

export interface StatsStore {
  recordTokenUsage(event: TokenUsageEvent & { timestamp: number }): void;
  recordAgentRun(event: AgentRunEvent & { timestamp: number }): void;
  getAgentStats(agentId: string): AgentStats;
  listAllAgentStats(): AgentStats[];
  getStatsForRange(from: number, to: number): AgentStats[];
}

export class InMemoryStatsStore implements StatsStore {
  private tokenEvents: (TokenUsageEvent & { timestamp: number })[] = [];
  private runEvents: (AgentRunEvent & { timestamp: number })[] = [];

  recordTokenUsage(event: TokenUsageEvent & { timestamp: number }): void {
    this.tokenEvents.push(event);
  }

  recordAgentRun(event: AgentRunEvent & { timestamp: number }): void {
    this.runEvents.push(event);
  }

  getAgentStats(agentId: string): AgentStats {
    const tokens = this.tokenEvents.filter(e => e.agentId === agentId);
    const runs = this.runEvents.filter(e => e.agentId === agentId);
    return {
      agentId,
      totalInputTokens: tokens.reduce((s, e) => s + e.inputTokens, 0),
      totalOutputTokens: tokens.reduce((s, e) => s + e.outputTokens, 0),
      callCount: tokens.length,
      runCount: runs.length,
      failureCount: runs.filter(r => !r.success).length,
      lastRunAt: runs.length > 0 ? Math.max(...runs.map(r => r.timestamp)) : 0,
    };
  }

  listAllAgentStats(): AgentStats[] {
    const agentIds = new Set([
      ...this.tokenEvents.map(e => e.agentId),
      ...this.runEvents.map(e => e.agentId),
    ]);
    return Array.from(agentIds).map(id => this.getAgentStats(id));
  }

  getStatsForRange(from: number, to: number): AgentStats[] {
    const tokenInRange = this.tokenEvents.filter(e => e.timestamp >= from && e.timestamp <= to);
    const runInRange = this.runEvents.filter(e => e.timestamp >= from && e.timestamp <= to);
    const agentIds = new Set([
      ...tokenInRange.map(e => e.agentId),
      ...runInRange.map(e => e.agentId),
    ]);
    return Array.from(agentIds).map(id => {
      const tokens = tokenInRange.filter(e => e.agentId === id);
      const runs = runInRange.filter(e => e.agentId === id);
      return {
        agentId: id,
        totalInputTokens: tokens.reduce((s, e) => s + e.inputTokens, 0),
        totalOutputTokens: tokens.reduce((s, e) => s + e.outputTokens, 0),
        callCount: tokens.length,
        runCount: runs.length,
        failureCount: runs.filter(r => !r.success).length,
        lastRunAt: runs.length > 0 ? Math.max(...runs.map(r => r.timestamp)) : 0,
      };
    });
  }
}

export class StatsCollector {
  constructor(private store: StatsStore) {}

  recordTokenUsage(event: TokenUsageEvent): void {
    this.store.recordTokenUsage({ ...event, timestamp: Date.now() });
  }

  recordAgentRun(event: AgentRunEvent): void {
    this.store.recordAgentRun({ ...event, timestamp: Date.now() });
  }
}
