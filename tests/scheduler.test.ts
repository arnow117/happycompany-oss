import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  computeNextRun,
  computeInitialNextRun,
} from '../src/scheduler.js';

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
