import { describe, it, expect, vi } from 'vitest';
import {
  parseDuration,
  computeNextRun,
  computeInitialNextRun,
  TaskScheduler,
  type ScheduledTask,
  type TaskStore,
} from '../src/scheduler.js';

function makeTask(over: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't1',
    name: 'task',
    botName: 'web-bot',
    scheduleType: 'cron',
    scheduleValue: '0 9 * * 1-5',
    prompt: 'do it',
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    ...over,
  };
}

function memoryStore(tasks: ScheduledTask[]): TaskStore {
  const map = new Map(tasks.map((t) => [t.id, { ...t }]));
  return {
    createTask: (t) => makeTask({ name: t.name, botName: t.botName, scheduleType: t.scheduleType, scheduleValue: t.scheduleValue, prompt: t.prompt }),
    listTasks: () => [...map.values()],
    getTask: (id) => map.get(id) ?? null,
    updateTask: (id, patch) => {
      const cur = map.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      map.set(id, next);
      return next;
    },
    deleteTask: (id) => map.delete(id),
  };
}

describe('TaskScheduler startup reconciliation (no missed-run storm)', () => {
  it('skips overdue cron tasks forward on start() without executing them', () => {
    const now = Date.now();
    const store = memoryStore([
      makeTask({ id: 'cron1', scheduleType: 'cron', scheduleValue: '* * * * *', nextRunAt: now - 600_000 }),
      makeTask({ id: 'cron2', scheduleType: 'cron', scheduleValue: '* * * * *', nextRunAt: now - 600_000 }),
    ]);
    const agent = { respond: vi.fn().mockResolvedValue('ok') };
    const sched = new TaskScheduler(store, agent, undefined, 60_000);

    sched.start();
    sched.stop();

    expect(agent.respond).not.toHaveBeenCalled();
    for (const t of store.listTasks()) {
      expect(t.nextRunAt).not.toBeNull();
      expect(t.nextRunAt!).toBeGreaterThan(now);
    }
  });

  it('leaves a `once` task overdue so it still fires (no skip for one-shot)', () => {
    const now = Date.now();
    const store = memoryStore([
      makeTask({ id: 'once1', scheduleType: 'once', scheduleValue: new Date(now - 1000).toISOString(), nextRunAt: now - 1000 }),
    ]);
    const agent = { respond: vi.fn().mockResolvedValue('ok') };
    const sched = new TaskScheduler(store, agent, undefined, 60_000);
    sched.start();
    sched.stop();
    expect(store.getTask('once1')!.nextRunAt).toBe(now - 1000);
  });
});

describe('parseDuration', () => {
  it('parses PT30M', () => {
    expect(parseDuration('PT30M')).toBe(30 * 60 * 1000);
  });

  it('parses PT1H', () => {
    expect(parseDuration('PT1H')).toBe(3600000);
  });

  it('parses PT1H30M', () => {
    expect(parseDuration('PT1H30M')).toBe(5400000);
  });

  it('parses PT5S', () => {
    expect(parseDuration('PT5S')).toBe(5000);
  });

  it('parses P1D', () => {
    expect(parseDuration('P1D')).toBe(86400000);
  });

  it('parses PT0.5H (fractional hours)', () => {
    expect(parseDuration('PT0.5H')).toBe(1800000);
  });

  it('parses P1DT2H30M (compound)', () => {
    const ms = parseDuration('P1DT2H30M');
    expect(ms).toBe(86400000 + 2 * 3600000 + 30 * 60000);
  });

  it('returns null for empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseDuration('invalid')).toBeNull();
  });

  it('returns null for random string', () => {
    expect(parseDuration('30min')).toBeNull();
  });
});

describe('computeNextRun', () => {
  it('cron: computes next occurrence from now', () => {
    // Every minute — should return a timestamp slightly in the future
    const result = computeNextRun('cron', '* * * * *', null, Date.now());
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(Date.now());
  });

  it('cron: returns next minute boundary', () => {
    const now = Date.now();
    const result = computeNextRun('cron', '* * * * *', null, now);
    expect(result).not.toBeNull();
    // Should be within the next 2 minutes
    expect(result! - now).toBeLessThan(120_000);
  });

  it('cron: returns null for invalid expression', () => {
    const result = computeNextRun('cron', 'not-a-cron', null, Date.now());
    expect(result).toBeNull();
  });

  it('cron: skips past times and returns next future time', () => {
    // Use a cron that fires at a specific minute — e.g. "0 0 31 2 *" (Feb 31, never fires)
    // Actually use a valid one: "0 0 1 1 *" (Jan 1 midnight)
    const result = computeNextRun('cron', '0 0 1 1 *', null, Date.now());
    // If we're past Jan 1 this year, next will be next year
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(Date.now());
  });

  it('interval: computes from lastRunAt', () => {
    const lastRunAt = Date.now() - 5 * 60 * 1000; // 5 min ago
    const now = Date.now();
    const result = computeNextRun('interval', 'PT30M', lastRunAt, now);
    expect(result).not.toBeNull();
    // Should be ~25 minutes from now (30min - 5min already passed)
    const diff = result! - now;
    expect(diff).toBeGreaterThan(20 * 60 * 1000); // >20min
    expect(diff).toBeLessThan(30 * 60 * 1000); // <30min
  });

  it('interval: computes from now when no lastRunAt', () => {
    const now = Date.now();
    const result = computeNextRun('interval', 'PT30M', null, now);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(now);
    expect(result! - now).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('interval: handles small intervals correctly', () => {
    const now = Date.now();
    const result = computeNextRun('interval', 'PT5S', null, now);
    expect(result).not.toBeNull();
    expect(result! - now).toBeLessThanOrEqual(5000);
  });

  it('interval: returns null for invalid duration', () => {
    const result = computeNextRun('interval', 'invalid', null, Date.now());
    expect(result).toBeNull();
  });

  it('once: always returns null (no repeat)', () => {
    const result = computeNextRun('once', '2026-12-31T00:00:00Z', null, Date.now());
    expect(result).toBeNull();
  });

  it('unknown type: returns null', () => {
    const result = computeNextRun('manual' as never, 'x', null, Date.now());
    expect(result).toBeNull();
  });
});

describe('computeInitialNextRun', () => {
  it('once: parses ISO datetime', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const result = computeInitialNextRun({
      name: 'test',
      botName: 'bot1',
      scheduleType: 'once',
      scheduleValue: future,
      prompt: 'hello',
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(Date.now());
  });

  it('once: returns null for invalid date', () => {
    const result = computeInitialNextRun({
      name: 'test',
      botName: 'bot1',
      scheduleType: 'once',
      scheduleValue: 'not-a-date',
      prompt: 'hello',
    });
    expect(result).toBeNull();
  });

  it('cron: delegates to computeNextRun', () => {
    const result = computeInitialNextRun({
      name: 'test',
      botName: 'bot1',
      scheduleType: 'cron',
      scheduleValue: '* * * * *',
      prompt: 'hello',
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(Date.now());
  });

  it('interval: delegates to computeNextRun', () => {
    const result = computeInitialNextRun({
      name: 'test',
      botName: 'bot1',
      scheduleType: 'interval',
      scheduleValue: 'PT1H',
      prompt: 'hello',
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(Date.now());
  });
});
