export interface ChainEvent {
  contractId: string;
  agentId: string;
  action: string;
  detail?: string;
  targetAgent?: string;
}

export interface ChainEntry extends ChainEvent {
  timestamp: number;
}

export interface ChainStore {
  addEvent(event: ChainEntry): void;
  getChain(contractId: string, agentId?: string): ChainEntry[];
  listContractsWithActivity(from: number, to: number): string[];
}

export class InMemoryChainStore implements ChainStore {
  private events: ChainEntry[] = [];

  addEvent(event: ChainEntry): void {
    this.events.push(event);
  }

  getChain(contractId: string, agentId?: string): ChainEntry[] {
    let filtered = this.events.filter(e => e.contractId === contractId);
    if (agentId) {
      filtered = filtered.filter(e => e.agentId === agentId);
    }
    return filtered.sort((a, b) => a.timestamp - b.timestamp);
  }

  listContractsWithActivity(from: number, to: number): string[] {
    const inRange = this.events.filter(e => e.timestamp >= from && e.timestamp <= to);
    return [...new Set(inRange.map(e => e.contractId))];
  }
}

export class ContractChainTracker {
  constructor(private store: ChainStore) {}

  recordEvent(event: ChainEvent): void {
    this.store.addEvent({ ...event, timestamp: Date.now() });
  }

  getChain(contractId: string, agentId?: string): ChainEntry[] {
    return this.store.getChain(contractId, agentId);
  }

  listContractsWithActivity(from: number, to: number): string[] {
    return this.store.listContractsWithActivity(from, to);
  }
}
