import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus } from '../src/bus.js';

describe('MessageBus event publishing', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('publishes domain events (contract.signed, maintenance.completed)', () => {
    const received: unknown[] = [];
    bus.subscribe((ev) => received.push(ev));

    bus.publishDomainEvent('contract.signed', { contractId: '001', hospitalName: '浙一' });

    expect(received).toHaveLength(1);
    const ev = received[0] as Record<string, unknown>;
    expect(ev.type).toBe('domain_event');
    expect(ev.domainEventType).toBe('contract.signed');
    expect(ev.meta).toEqual({ contractId: '001', hospitalName: '浙一' });
  });

  it('routes domain events to subscribed agent inboxes', () => {
    bus.subscribeToDomainEvent('contract.signed', 'finance-agent');
    bus.subscribeToDomainEvent('contract.signed', 'sales-mgr');

    bus.publishDomainEvent('contract.signed', { contractId: '001' });

    const financeInbox = bus.getInbox('finance-agent');
    const salesInbox = bus.getInbox('sales-mgr');
    const otherInbox = bus.getInbox('other-agent');

    expect(financeInbox).toHaveLength(1);
    expect(salesInbox).toHaveLength(1);
    expect(otherInbox).toHaveLength(0);
  });

  it('drains inbox for an agent', () => {
    bus.subscribeToDomainEvent('contract.signed', 'finance-agent');
    bus.publishDomainEvent('contract.signed', { contractId: '001' });
    bus.publishDomainEvent('contract.signed', { contractId: '002' });

    const drained = bus.drainInbox('finance-agent');
    expect(drained).toHaveLength(2);
    expect(bus.getInbox('finance-agent')).toHaveLength(0);
  });

  it('limits inbox size per agent (max 100)', () => {
    bus.subscribeToDomainEvent('test.event', 'agent-1');
    for (let i = 0; i < 110; i++) {
      bus.publishDomainEvent('test.event', { i });
    }
    expect(bus.getInbox('agent-1')).toHaveLength(100);
  });
});
