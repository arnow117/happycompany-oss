import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '../../src/ingress/trace-recorder.js';

function makeClock(start = 1_000): () => number {
  let t = start;
  return () => {
    t += 1;
    return t;
  };
}

describe('TraceRecorder', () => {
  it('seeds input identity and empty channels', () => {
    const rec = new TraceRecorder({
      channel: 'web',
      botName: 'web-tester',
      chatId: 'chat-1',
      userId: 'user-x',
      clock: makeClock(),
    });
    const trace = rec.snapshot();
    expect(trace.input).toMatchObject({
      channel: 'web',
      botName: 'web-tester',
      chatId: 'chat-1',
      userId: 'user-x',
    });
    expect(trace.toolCalls).toEqual([]);
    expect(trace.memory).toEqual([]);
    expect(trace.handoffs).toEqual([]);
    expect(trace.errors).toEqual([]);
    expect(trace.startedAt).toBeGreaterThan(0);
    expect(trace.finishedAt).toBeUndefined();
  });

  it('merges routing patches instead of replacing', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c' });
    rec.recordRouting({ mode: 'employee-director', selectorShown: true });
    rec.recordRouting({ selectedEmployee: 'sales-zhangsan', selectorShown: false });
    expect(rec.snapshot().routing).toEqual({
      mode: 'employee-director',
      selectedEmployee: 'sales-zhangsan',
      selectorShown: false,
    });
  });

  it('pairs tool start/end by toolUseId', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c', clock: makeClock(100) });
    rec.recordToolStart({ toolName: 'med_crm:search', toolUseId: 'use-1' });
    rec.recordToolEnd({ toolName: 'med_crm:search', toolUseId: 'use-1', elapsedMs: 50 });
    const calls = rec.snapshot().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'med_crm:search', status: 'complete', elapsedMs: 50 });
  });

  it('creates synthetic tool entry when end arrives without start', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c' });
    rec.recordToolEnd({ toolName: 'late', toolUseId: 'no-start', elapsedMs: 10 });
    const calls = rec.snapshot().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'late', status: 'complete', elapsedMs: 10 });
  });

  it('records tool error and a matching error entry', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c' });
    rec.recordToolStart({ toolName: 'flaky', toolUseId: 'u' });
    rec.recordToolError({ toolName: 'flaky', toolUseId: 'u', message: 'boom' });
    const trace = rec.snapshot();
    expect(trace.toolCalls[0]?.status).toBe('error');
    expect(trace.errors).toHaveLength(1);
    expect(trace.errors[0]).toMatchObject({ stage: 'tool', message: 'flaky: boom' });
  });

  it('records memory and handoff with timestamps', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c', clock: makeClock(0) });
    rec.recordMemory({ operation: 'append', subject: 'sales-zhangsan', workspace: 'corp/x/agents/sales' });
    rec.recordHandoff({ from: 'sales-zhangsan', to: 'service-li', reason: 'after-sale' });
    const trace = rec.snapshot();
    expect(trace.memory[0]).toMatchObject({ operation: 'append', status: 'ok' });
    expect(trace.handoffs[0]).toMatchObject({ from: 'sales-zhangsan', to: 'service-li' });
  });

  it('finish stamps finishedAt and snapshot is immutable from outside', () => {
    const rec = new TraceRecorder({ channel: 'harness', botName: 'b', chatId: 'c' });
    rec.recordError('routing', 'no employee bound');
    const out = rec.finish();
    expect(out.finishedAt).toBeDefined();
    out.errors.push({ stage: 'mutation', message: 'should not leak', at: 0 });
    const fresh = rec.snapshot();
    expect(fresh.errors).toHaveLength(1);
  });
});
