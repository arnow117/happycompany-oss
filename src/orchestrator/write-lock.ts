export interface WriteLockConfig {
  enabled: boolean;
  defaultTTL: number; // milliseconds
}

export interface LockRequest {
  entity: string;
  entityId: string;
  lockedBy: string;
}

export interface WriteLock {
  entity: string;
  entityId: string;
  lockedBy: string;
  lockedAt: number;
  expiresAt: number;
}

export interface AcquireResult {
  acquired: boolean;
  lock?: WriteLock;
  heldBy?: string;
}

export class WriteLockManager {
  private locks = new Map<string, WriteLock>(); // "entity:entityId" -> WriteLock

  constructor(private config: WriteLockConfig) {}

  acquire(req: LockRequest): AcquireResult {
    if (!this.config.enabled) {
      const lock = this.makeLock(req);
      return { acquired: true, lock };
    }

    const key = `${req.entity}:${req.entityId}`;
    const existing = this.locks.get(key);

    if (existing) {
      // Check expiration
      if (existing.expiresAt < Date.now()) {
        this.locks.delete(key);
      } else if (existing.lockedBy !== req.lockedBy) {
        return { acquired: false, heldBy: existing.lockedBy };
      }
    }

    const lock = this.makeLock(req);
    this.locks.set(key, lock);
    return { acquired: true, lock };
  }

  release(entity: string, entityId: string, lockedBy: string): boolean {
    const key = `${entity}:${entityId}`;
    const lock = this.locks.get(key);
    if (!lock || lock.lockedBy !== lockedBy) return false;
    this.locks.delete(key);
    return true;
  }

  isLocked(entity: string, entityId: string): boolean {
    const key = `${entity}:${entityId}`;
    const lock = this.locks.get(key);
    if (!lock) return false;
    if (lock.expiresAt < Date.now()) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }

  getLock(entity: string, entityId: string): WriteLock | undefined {
    const key = `${entity}:${entityId}`;
    return this.locks.get(key);
  }

  getAgentLocks(agentId: string): WriteLock[] {
    const result: WriteLock[] = [];
    for (const lock of this.locks.values()) {
      if (lock.lockedBy === agentId && lock.expiresAt >= Date.now()) {
        result.push(lock);
      }
    }
    return result;
  }

  getAllLocks(): WriteLock[] {
    const result: WriteLock[] = [];
    for (const lock of this.locks.values()) {
      if (lock.expiresAt >= Date.now()) {
        result.push(lock);
      }
    }
    return result;
  }

  private makeLock(req: LockRequest): WriteLock {
    const now = Date.now();
    return {
      entity: req.entity,
      entityId: req.entityId,
      lockedBy: req.lockedBy,
      lockedAt: now,
      expiresAt: now + this.config.defaultTTL,
    };
  }
}
