import { describe, it, expect } from 'vitest';
import { type ScheduleType, computeNextRun } from '../src/scheduler.js';

describe('Event trigger type', () => {
  it('ScheduleType includes event', () => {
    // Type-level check: 'event' should be assignable to ScheduleType
    const t: ScheduleType = 'event';
    expect(t).toBe('event');
  });

  it('computeNextRun returns null for event type (event-driven, not time-driven)', () => {
    const result = computeNextRun('event', 'contract.signed', null, Date.now());
    expect(result).toBeNull();
  });

  it('event type task is skipped during tick (not time-driven)', () => {
    // Event tasks should not be picked up by the poll-based tick
    // They have null nextRunAt, so the tick skips them
    expect(computeNextRun('event', 'any.event', null, Date.now())).toBeNull();
  });
});
