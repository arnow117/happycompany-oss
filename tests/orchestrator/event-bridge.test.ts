import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBridge } from '../../src/orchestrator/event-bridge.js';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';
import type { MessageBus } from '../../src/bus.js';
import type { AgentRespond } from '../../src/scheduler.js';

describe('EventBridge', () => {
  let bus: MessageBus;
  let agent: AgentRespond;
  let bridge: EventBridge;

  beforeEach(() => {
    bus = {
      publishDomainEvent: vi.fn(),
      subscribeToDomainEvent: vi.fn(() => vi.fn()),
      subscribe: vi.fn(() => vi.fn()),
      getInbox: vi.fn(() => []),
      drainInbox: vi.fn(() => []),
    } as unknown as MessageBus;

    agent = { respond: vi.fn().mockResolvedValue('ok') };

    bridge = new EventBridge({ bus, agent });
  });

  it('registers event triggers from EmployeeDefinition on startup', () => {
    const apps: LoadedEmployee[] = [{
      id: 'finance-agent',
      displayName: 'Finance',
      tenantName: 'acme',
      filePath: '/test.yaml',
      loadedAtMs: Date.now(),
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'New contract: check payment', enabled: true },
          { type: 'cron', value: '0 9 * * 1', prompt: 'Daily check', enabled: true },
        ],
      },
    }];

    bridge.registerEmployeeEventTriggers(apps);

    expect(bus.subscribeToDomainEvent).toHaveBeenCalledWith('contract.signed', 'finance-agent');
    // cron trigger should NOT be registered
    expect(bus.subscribeToDomainEvent).toHaveBeenCalledTimes(1);
  });

  it('triggers agent execution when domain event fires', async () => {
    const { MessageBus } = await import('../../src/bus.js');

    const realBus = new MessageBus();
    const realAgent = { respond: vi.fn().mockResolvedValue('ok') };
    const realBridge = new EventBridge({ bus: realBus, agent: realAgent });

    const apps: LoadedEmployee[] = [{
      id: 'finance-agent',
      displayName: 'Finance',
      tenantName: 'acme',
      filePath: '/test.yaml',
      loadedAtMs: Date.now(),
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'Process contract {{contractId}}', enabled: true },
        ],
      },
    }];

    realBridge.registerEmployeeEventTriggers(apps);

    // Publish a matching domain event
    realBus.publishDomainEvent('contract.signed', { contractId: '001' });

    // Agent should have been called with prompt interpolated
    await new Promise((r) => setTimeout(r, 50));
    expect(realAgent.respond).toHaveBeenCalledWith(
      expect.stringContaining('001'),
      expect.any(String),
      'finance-agent',
    );

    realBridge.stop();
  });

  it('removes event subscriptions when app is unregistered', () => {
    const unsubscribeSpy = vi.fn();
    bus = {
      publishDomainEvent: vi.fn(),
      subscribeToDomainEvent: vi.fn(() => unsubscribeSpy),
      subscribe: vi.fn(() => vi.fn()),
      getInbox: vi.fn(() => []),
      drainInbox: vi.fn(() => []),
    } as unknown as MessageBus;

    agent = { respond: vi.fn().mockResolvedValue('ok') };
    bridge = new EventBridge({ bus, agent });

    const apps: LoadedEmployee[] = [{
      id: 'finance-agent',
      displayName: 'Finance',
      tenantName: 'acme',
      filePath: '/test.yaml',
      loadedAtMs: Date.now(),
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'check', enabled: true },
        ],
      },
    }];

    bridge.registerEmployeeEventTriggers(apps);
    bridge.removeAppEventTriggers('finance-agent');

    // The unsubscribe function should have been called
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('stop removes all subscriptions', () => {
    const unsubscribeSpy = vi.fn();
    bus = {
      publishDomainEvent: vi.fn(),
      subscribeToDomainEvent: vi.fn(() => unsubscribeSpy),
      subscribe: vi.fn(() => vi.fn()),
      getInbox: vi.fn(() => []),
      drainInbox: vi.fn(() => []),
    } as unknown as MessageBus;

    agent = { respond: vi.fn().mockResolvedValue('ok') };
    bridge = new EventBridge({ bus, agent });

    const apps: LoadedEmployee[] = [{
      id: 'agent-a',
      displayName: 'A',
      tenantName: 't',
      filePath: '/a.yaml',
      loadedAtMs: Date.now(),
      schedule: {
        triggers: [
          { type: 'event', value: 'e1', prompt: 'p1', enabled: true },
          { type: 'event', value: 'e2', prompt: 'p2', enabled: true },
        ],
      },
    }];

    bridge.registerEmployeeEventTriggers(apps);
    bridge.stop();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(2);
  });
});
