import { describe, it, expect, beforeEach } from 'vitest';
import { ContractChainTracker, InMemoryChainStore } from '../../src/orchestrator/contract-chain.js';

describe('ContractChainTracker', () => {
  let store: InMemoryChainStore;
  let tracker: ContractChainTracker;

  beforeEach(() => {
    store = new InMemoryChainStore();
    tracker = new ContractChainTracker(store);
  });

  it('records a chain event', () => {
    tracker.recordEvent({
      contractId: '001',
      agentId: 'sales-agent',
      action: 'contract_signed',
      detail: '客户同意签约',
    });
    const chain = tracker.getChain('001');
    expect(chain).toHaveLength(1);
    expect(chain[0].action).toBe('contract_signed');
  });

  it('builds full chain timeline', () => {
    const t = Date.now();
    tracker.recordEvent({ contractId: '001', agentId: 'sales-agent', action: 'contract_signed', detail: '已签署' });
    tracker.recordEvent({ contractId: '001', agentId: 'sales-agent', action: 'handoff', detail: '→ 维修', targetAgent: 'repair-agent' });
    tracker.recordEvent({ contractId: '001', agentId: 'repair-agent', action: 'install_scheduled', detail: '安排周三装机' });

    const chain = tracker.getChain('001');
    expect(chain).toHaveLength(3);
  });

  it('filters chain by agent', () => {
    tracker.recordEvent({ contractId: '001', agentId: 'sales-agent', action: 'signed' });
    tracker.recordEvent({ contractId: '001', agentId: 'repair-agent', action: 'installed' });
    tracker.recordEvent({ contractId: '001', agentId: 'sales-agent', action: 'followup' });

    const salesEvents = tracker.getChain('001', 'sales-agent');
    expect(salesEvents).toHaveLength(2);
  });

  it('lists contracts with activity in date range', () => {
    const now = Date.now();
    tracker.recordEvent({ contractId: '001', agentId: 'agent', action: 'test' });
    const contracts = tracker.listContractsWithActivity(now - 60000, now + 60000);
    expect(contracts).toContain('001');
  });

  it('returns empty chain for unknown contract', () => {
    expect(tracker.getChain('nonexistent')).toHaveLength(0);
  });
});
