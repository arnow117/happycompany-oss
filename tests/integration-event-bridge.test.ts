import { describe, it, expect } from 'vitest';
import { EventBridge } from '../src/orchestrator/event-bridge.js';
import { MessageBus } from '../src/bus.js';
import { employeeDefinitionSchema } from '../src/orchestrator/employee-schema.js';
import type { LoadedEmployee } from '../src/orchestrator/employee-loader.js';

describe('EventBridge integration', () => {
  it('event triggers from YAML config are registered correctly', () => {
    const yaml = {
      id: 'finance',
      displayName: 'Finance Agent',
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'Process {{contractId}}', enabled: true },
          { type: 'cron', value: '0 9 * * 1-5', prompt: 'Daily review', enabled: true },
        ],
      },
    };

    const app = employeeDefinitionSchema.parse(yaml);
    const eventTriggers = app.schedule?.triggers?.filter((t) => t.type === 'event');
    expect(eventTriggers).toHaveLength(1);
    expect(eventTriggers?.[0]?.value).toBe('contract.signed');
  });

  it('EventBridge works with real MessageBus inbox', () => {
    const bus = new MessageBus();
    const agent = { respond: async () => 'ok' };
    const bridge = new EventBridge({ bus, agent });

    const apps: LoadedEmployee[] = [{
      id: 'finance',
      displayName: 'Finance',
      tenantName: 'test',
      filePath: '/test.yaml',
      loadedAtMs: Date.now(),
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'New contract', enabled: true },
        ],
      },
    }];

    bridge.registerEmployeeEventTriggers(apps);
    bus.publishDomainEvent('contract.signed', { contractId: '001' });

    expect(bus.getInbox('finance')).toHaveLength(1);
    expect(bus.getInbox('finance')[0].payload).toEqual({ contractId: '001' });

    bridge.stop();
  });
});
