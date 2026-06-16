/**
 * TTL-bounded LRU for message-id deduplication.
 *
 * Use case: a single channel bot can receive the same event twice (WS retry,
 * reconnect backfill). We want the first claim() call for a given key to
 * return true, subsequent ones to return false.
 *
 * - Bounded by maxEntries (oldest by access evicted)
 * - TTL-bounded (claims older than ttlMs auto-expire)
 */
export class DedupCache {
  private readonly store = new Map<string, number>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly ttlMs = 30 * 60 * 1000,
  ) {}

  /**
   * Claim a key. Returns true if this is the first time claiming within the
   * TTL window; false if it was recently seen.
   */
  claim(key: string): boolean {
    const now = Date.now();
    this.evictExpired(now);

    const existing = this.store.get(key);
    if (existing !== undefined && now - existing < this.ttlMs) {
      // Refresh access order
      this.store.delete(key);
      this.store.set(key, existing);
      return false;
    }

    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, now);
    return true;
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [key, ts] of this.store) {
      if (ts >= cutoff) {
        break; // Map preserves insertion order; once non-expired, stop
      }
      this.store.delete(key);
    }
  }

  size(): number {
    return this.store.size;
  }
}
