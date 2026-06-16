import { describe, it, expect } from 'vitest';
import { DedupCache } from '../src/dedup.js';

describe('DedupCache', () => {
  it('returns true on first claim', () => {
    const cache = new DedupCache();
    const result = cache.claim('msg-001');

    expect(result).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('returns false on duplicate claim within TTL', () => {
    const cache = new DedupCache();
    cache.claim('msg-001');
    const result = cache.claim('msg-001');

    expect(result).toBe(false);
    expect(cache.size()).toBe(1);
  });

  it('returns true after TTL expires (ttlMs = 0)', () => {
    const cache = new DedupCache(1000, 0);
    cache.claim('msg-001');

    // With ttlMs = 0, next claim should treat the entry as expired
    const result = cache.claim('msg-001');

    expect(result).toBe(true);
  });

  it('evicts oldest entry when capacity is reached', () => {
    const cache = new DedupCache(3);

    cache.claim('msg-001');
    cache.claim('msg-002');
    cache.claim('msg-003');
    expect(cache.size()).toBe(3);

    // msg-001 should be evicted; msg-004 inserted
    cache.claim('msg-004');
    expect(cache.size()).toBe(3);

    // msg-001 is gone, so a new claim should succeed
    const result = cache.claim('msg-001');
    expect(result).toBe(true);
  });
});
