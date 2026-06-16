/** A single step in an orchestration trace. */
export interface TraceStep {
  from: string;
  to: string;
  action: string;
  timestamp: number;
  task?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

/** A complete orchestration trace — what actually happened in one run. */
export interface OrchestrationTrace {
  id: string;
  entryAgent: string;
  prompt: string;
  success: boolean;
  summary: string;
  route: string[];
  handoffCount: number;
  iterationCount: number;
  steps: TraceStep[];
  startedAt: number;
  finishedAt: number;
}

export class TraceStore {
  private traces: OrchestrationTrace[] = [];

  save(trace: OrchestrationTrace): void {
    this.traces.push(trace);
    if (this.traces.length > 100) {
      this.traces = this.traces.slice(-50);
    }
  }

  list(limit = 20): OrchestrationTrace[] {
    return this.traces.slice(-limit).reverse();
  }

  get(id: string): OrchestrationTrace | undefined {
    return this.traces.find((t) => t.id === id);
  }

  getByAgent(agentId: string, limit = 20): OrchestrationTrace[] {
    return this.traces
      .filter((t) => t.route.includes(agentId))
      .slice(-limit)
      .reverse();
  }

  /** Build graph data from a trace for visualization. */
  static toGraph(trace: OrchestrationTrace): {
    nodes: Array<{ id: string; label: string; type: string; role?: string }>;
    edges: Array<{ source: string; target: string; label: string }>;
  } {
    const nodes: Array<{ id: string; label: string; type: string; role?: string }> = [];
    const edges: Array<{ source: string; target: string; label: string }> = [];
    const seen = new Set<string>();

    for (const step of trace.steps) {
      if (!seen.has(step.from)) {
        seen.add(step.from);
        nodes.push({ id: step.from, label: step.from, type: 'agent' });
      }
      if (!seen.has(step.to)) {
        seen.add(step.to);
        nodes.push({ id: step.to, label: step.to, type: 'agent' });
      }
      edges.push({ source: step.from, target: step.to, label: step.action });
    }

    return { nodes, edges };
  }
}
