import { describe, it, expect } from 'vitest';
import { HandoffRequest, claimsCompletedHandoff, extractHandoffRequest } from '../../src/orchestrator/handoff.js';

describe('HandoffRequest', () => {
  it('constructs with targetAgent and payload', () => {
    const payload = { event: 'node_completed', contractId: 'c-001' };
    const req = new HandoffRequest('agent-b', payload);

    expect(req.type).toBe('handoff_request');
    expect(req.targetAgent).toBe('agent-b');
    expect(req.payload).toEqual(payload);
  });

  it('serializes to JSON via toJson()', () => {
    const payload = { event: 'node_started', context: { role: 'nurse' } };
    const req = new HandoffRequest('agent-c', payload);
    const json = req.toJson();

    expect(json).toEqual({
      type: 'handoff_request',
      target_agent: 'agent-c',
      payload,
    });
  });
});

describe('claimsCompletedHandoff', () => {
  it('detects natural-language claims that a handoff already happened', () => {
    expect(claimsCompletedHandoff('已 handoff 给维修李四，后续等待回复。')).toBe(true);
    expect(claimsCompletedHandoff('任务已经转交给财务王五。')).toBe(true);
    expect(claimsCompletedHandoff('Handoff has been completed to the service agent.')).toBe(true);
  });

  it('does not flag planning or conditional handoff language', () => {
    expect(claimsCompletedHandoff('如果需要，我可以 handoff 给维修李四。')).toBe(false);
    expect(claimsCompletedHandoff('下一步可能需要转交给财务。')).toBe(false);
  });
});

describe('extractHandoffRequest', () => {
  it('extracts from text with embedded JSON', () => {
    const text = `Here is my response.
{"type":"handoff_request","target_agent":"agent-x","payload":{"event":"node_completed","contractId":"c-123"}}
That is the handoff.`;

    const result = extractHandoffRequest(text);
    expect(result).not.toBeNull();
    expect(result!.targetAgent).toBe('agent-x');
    expect(result!.payload.event).toBe('node_completed');
    expect(result!.payload.contractId).toBe('c-123');
    expect(result!.payload.context).toEqual({});
  });

  it('returns null when no handoff JSON present', () => {
    const text = 'Just a regular response with no JSON at all.';
    expect(extractHandoffRequest(text)).toBeNull();
  });

  it('returns null for wrong type field', () => {
    const text = `{"type":"other_thing","target_agent":"agent-x","payload":{"event":"test"}}`;
    expect(extractHandoffRequest(text)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const text = `{"type":"handoff_request","target_agent":"agent-x","payload":{broken}`;
    expect(extractHandoffRequest(text)).toBeNull();
  });

  it('allows missing target_agent for director routing', () => {
    const text = `{"type":"handoff_request","payload":{"event":"test"}}`;
    const result = extractHandoffRequest(text);
    expect(result).not.toBeNull();
    expect(result!.targetAgent).toBe('');
    expect(result!.payload.event).toBe('test');
  });

  it('extracts from text with multiple JSON blocks (picks first handoff)', () => {
    const text = `Some intro.
{"type":"status_update","payload":{"msg":"hi"}}
{"type":"handoff_request","target_agent":"agent-y","payload":{"event":"node_completed"}}
More text.`;

    const result = extractHandoffRequest(text);
    expect(result).not.toBeNull();
    expect(result!.targetAgent).toBe('agent-y');
  });
});
