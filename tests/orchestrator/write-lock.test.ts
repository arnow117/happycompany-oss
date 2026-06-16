import { describe, it, expect, beforeEach } from 'vitest';
import { WriteLockManager } from '../../src/orchestrator/write-lock.js';

describe('WriteLockManager', () => {
  let mgr: WriteLockManager;

  beforeEach(() => {
    mgr = new WriteLockManager({ defaultTTL: 5000, enabled: true });
  });

  it('acquires lock on unlocked entity', () => {
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    expect(result.acquired).toBe(true);
    expect(result.lock).toBeDefined();
    expect(result.lock?.lockedBy).toBe('sales-agent');
  });

  it('rejects lock when entity is locked by another agent', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'other-agent' });
    expect(result.acquired).toBe(false);
    expect(result.heldBy).toBe('sales-agent');
  });

  it('allows re-lock by same agent (renewal)', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    expect(result.acquired).toBe(true);
  });

  it('auto-expires locks after TTL', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    // Manually expire
    const lock = mgr.getLock('contract', '001');
    if (lock) lock.expiresAt = Date.now() - 1000;
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'other-agent' });
    expect(result.acquired).toBe(true);
  });

  it('releases lock', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    mgr.release('contract', '001', 'sales-agent');
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'other-agent' });
    expect(result.acquired).toBe(true);
  });

  it('cannot release lock held by another agent', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    mgr.release('contract', '001', 'other-agent'); // Wrong agent
    const result = mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'other-agent' });
    expect(result.acquired).toBe(false);
  });

  it('check reports lock status', () => {
    expect(mgr.isLocked('contract', '001')).toBe(false);
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    expect(mgr.isLocked('contract', '001')).toBe(true);
  });

  it('returns all locks for an agent', () => {
    mgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'sales-agent' });
    mgr.acquire({ entity: 'device', entityId: '002', lockedBy: 'sales-agent' });
    const locks = mgr.getAgentLocks('sales-agent');
    expect(locks).toHaveLength(2);
  });

  it('disabled mode always acquires', () => {
    const disabledMgr = new WriteLockManager({ defaultTTL: 5000, enabled: false });
    disabledMgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'agent-1' });
    const result = disabledMgr.acquire({ entity: 'contract', entityId: '001', lockedBy: 'agent-2' });
    expect(result.acquired).toBe(true);
  });
});
