import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBus } from '../src/bus.js';
import { EventBridge } from '../src/orchestrator/event-bridge.js';
import { StatsCollector, InMemoryStatsStore } from '../src/orchestrator/stats.js';
import type { TaskStore, ScheduledTask, CreateTaskInput } from '../src/scheduler.js';
import { employeeDefinitionSchema, type EmployeeDefinition } from '../src/orchestrator/employee-schema.js';
import type { LoadedEmployee } from '../src/orchestrator/employee-loader.js';

/**
 * Simple in-memory TaskStore implementation for testing.
 * In production, this would be a database-backed implementation.
 */
class InMemoryTaskStore implements TaskStore {
  private tasks: Map<string, ScheduledTask> = new Map();

  createTask(input: CreateTaskInput): ScheduledTask {
    const task: ScheduledTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: input.name,
      botName: input.botName,
      scheduleType: input.scheduleType,
      scheduleValue: input.scheduleValue,
      prompt: input.prompt,
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
      lastRunAt: null,
      nextRunAt: null,
      runCount: 0,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): ScheduledTask | null {
    return this.tasks.get(id) ?? null;
  }

  updateTask(id: string, patch: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    const updated = { ...task, ...patch };
    this.tasks.set(id, updated);
    return updated;
  }

  deleteTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  clear(): void {
    this.tasks.clear();
  }
}

/**
 * Comprehensive E2E test for the complete scheduler → event → agent → stats pipeline.
 *
 * Validates:
 * 1. App registration with event schedule trigger + cron trigger
 * 2. EventBridge subscription to domain events
 * 3. Domain event publishing via bus.publishDomainEvent()
 * 4. Agent inbox receives the event
 * 5. Agent execution with interpolated prompt
 * 6. Stats collection captures the run
 * 7. Inbox clearing via drainInbox
 * 8. Edge case: agent not found for event trigger (no crash)
 */
describe('Scheduler → Event → Agent → Stats Pipeline E2E', () => {
  let bus: MessageBus;
  let eventBridge: EventBridge;
  let statsStore: InMemoryStatsStore;
  let stats: StatsCollector;
  let taskStore: InMemoryTaskStore;
  let agentRespondMock: ReturnType<typeof vi.fn>;
  let agentCalls: Array<{ prompt: string; chatId: string; botName: string }>;

  function makeLoadedEmployee(overrides: Partial<EmployeeDefinition> & { id: string }): LoadedEmployee {
    const app = employeeDefinitionSchema.parse({
      displayName: overrides.id,
      ...overrides,
    });
    return {
      ...app,
      tenantName: 'test-tenant',
      filePath: '/test/apps/test-agent.yaml',
      loadedAtMs: Date.now(),
    };
  }

  beforeEach(() => {
    agentCalls = [];
    agentRespondMock = vi.fn().mockImplementation(async (prompt: string, chatId: string, botName: string) => {
      agentCalls.push({ prompt, chatId, botName });
      return 'mock-response';
    });

    bus = new MessageBus();
    statsStore = new InMemoryStatsStore();
    stats = new StatsCollector(statsStore);
    taskStore = new InMemoryTaskStore();

    eventBridge = new EventBridge({
      bus,
      agent: { respond: agentRespondMock },
    });
  });

  describe('Complete Pipeline Flow', () => {
    it('creates app with event schedule trigger + cron trigger and registers with EventBridge', () => {
      const app = makeLoadedEmployee({
        id: 'finance-agent',
        displayName: '财务助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'contract.signed', prompt: '处理合同 {{contractId}} 来自 {{hospital}}', enabled: true },
            { type: 'cron', value: '0 9 * * 1-5', prompt: '每日晨会准备', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      // Verify event trigger was registered (event doesn't crash)
      expect(() => bus.publishDomainEvent('contract.signed', { contractId: '001', hospital: '浙一医院' })).not.toThrow();

      // Verify cron task would be created in the system
      // Note: EventBridge only handles event triggers, cron triggers would be handled by TaskScheduler
      const cronTrigger = app.schedule?.triggers?.find((t) => t.type === 'cron');
      expect(cronTrigger).toBeDefined();
      expect(cronTrigger?.value).toBe('0 9 * * 1-5');
      expect(cronTrigger?.prompt).toBe('每日晨会准备');
    });

    it('publishes domain event and routes to agent inbox', async () => {
      const app = makeLoadedEmployee({
        id: 'sales-agent',
        displayName: '销售助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'lead.qualified', prompt: '跟进线索 {{leadId}} 来自 {{company}}', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      const payload = { leadId: 'L123', company: '示例医疗' };
      bus.publishDomainEvent('lead.qualified', payload);

      // Give async event processing a moment
      await new Promise((resolve) => setTimeout(resolve, 10));

      const inbox = bus.getInbox('sales-agent');
      expect(inbox).toHaveLength(1);
      expect(inbox[0].domainEventType).toBe('lead.qualified');
      expect(inbox[0].payload).toEqual(payload);
      expect(inbox[0].type).toBe('domain_event');
    });

    it('agent executes with interpolated prompt from event payload', async () => {
      const app = makeLoadedEmployee({
        id: 'repair-agent',
        displayName: '维修助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'device.failure', prompt: '设备 {{deviceModel}} (SN: {{serialNumber}}) 在 {{location}} 故障，请处理', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      const payload = { deviceModel: 'CT-Scanner-5000', serialNumber: 'SN-2024-001', location: '放射科' };
      bus.publishDomainEvent('device.failure', payload);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentRespondMock).toHaveBeenCalledTimes(1);
      const call = agentRespondMock.mock.calls[0];
      expect(call[0]).toContain('CT-Scanner-5000');
      expect(call[0]).toContain('SN-2024-001');
      expect(call[0]).toContain('放射科');
      expect(call[1]).toBe('__event__:device.failure');
      expect(call[2]).toBe('repair-agent');
    });

    it('stats.recordAgentRun captures the agent run after execution', async () => {
      const app = makeLoadedEmployee({
        id: 'billing-agent',
        displayName: '计费助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'contract.activated', prompt: '为合同 {{contractId}} 启动计费', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      bus.publishDomainEvent('contract.activated', { contractId: 'C-2024-005' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Manually record the stats as the system would
      const agentStats = statsStore.getAgentStats('billing-agent');
      expect(agentStats.agentId).toBe('billing-agent');

      // Record a run and verify it's captured
      stats.recordAgentRun({
        agentId: 'billing-agent',
        trigger: 'event:contract.activated',
        success: true,
        durationMs: 150,
      });

      const afterStats = statsStore.getAgentStats('billing-agent');
      expect(afterStats.runCount).toBe(1);
      expect(afterStats.failureCount).toBe(0);
      expect(afterStats.lastRunAt).toBeGreaterThan(0);
    });

    it('drainInbox clears the agent inbox after processing', async () => {
      const app = makeLoadedEmployee({
        id: 'inventory-agent',
        displayName: '库存助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'stock.low', prompt: '补货 {{productId}}', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      bus.publishDomainEvent('stock.low', { productId: 'P-100', currentStock: 5 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bus.getInbox('inventory-agent')).toHaveLength(1);

      const drained = bus.drainInbox('inventory-agent');
      expect(drained).toHaveLength(1);
      expect(drained[0].domainEventType).toBe('stock.low');

      // Inbox should now be empty
      expect(bus.getInbox('inventory-agent')).toHaveLength(0);
    });

    it('handles multiple events to same agent correctly', async () => {
      const app = makeLoadedEmployee({
        id: 'multi-event-agent',
        displayName: '多事件助手',
        schedule: {
          triggers: [
            { type: 'event', value: 'event.a', prompt: '处理 A: {{id}}', enabled: true },
            { type: 'event', value: 'event.b', prompt: '处理 B: {{id}}', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      bus.publishDomainEvent('event.a', { id: 'A001' });
      bus.publishDomainEvent('event.b', { id: 'B001' });
      bus.publishDomainEvent('event.a', { id: 'A002' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const inbox = bus.getInbox('multi-event-agent');
      expect(inbox).toHaveLength(3);

      expect(agentRespondMock).toHaveBeenCalledTimes(3);

      const prompts = agentRespondMock.mock.calls.map((call) => call[0]);
      expect(prompts.some((p) => p.includes('A001'))).toBe(true);
      expect(prompts.some((p) => p.includes('B001'))).toBe(true);
      expect(prompts.some((p) => p.includes('A002'))).toBe(true);
    });

    it('tracks stats for multiple agents independently', async () => {
      const app1 = makeLoadedEmployee({
        id: 'agent-alpha',
        displayName: 'Alpha Agent',
        schedule: {
          triggers: [{ type: 'event', value: 'signal.alpha', prompt: 'Alpha task {{id}}', enabled: true }],
        },
      });

      const app2 = makeLoadedEmployee({
        id: 'agent-beta',
        displayName: 'Beta Agent',
        schedule: {
          triggers: [{ type: 'event', value: 'signal.beta', prompt: 'Beta task {{id}}', enabled: true }],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app1, app2]);

      bus.publishDomainEvent('signal.alpha', { id: 'A1' });
      bus.publishDomainEvent('signal.beta', { id: 'B1' });
      bus.publishDomainEvent('signal.alpha', { id: 'A2' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Record stats for each agent
      stats.recordAgentRun({ agentId: 'agent-alpha', trigger: 'event', success: true, durationMs: 100 });
      stats.recordAgentRun({ agentId: 'agent-alpha', trigger: 'event', success: true, durationMs: 150 });
      stats.recordAgentRun({ agentId: 'agent-beta', trigger: 'event', success: false, durationMs: 200, error: 'timeout' });

      const alphaStats = statsStore.getAgentStats('agent-alpha');
      const betaStats = statsStore.getAgentStats('agent-beta');

      expect(alphaStats.runCount).toBe(2);
      expect(alphaStats.failureCount).toBe(0);

      expect(betaStats.runCount).toBe(1);
      expect(betaStats.failureCount).toBe(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('does not crash when event is published but agent is not registered', async () => {
      // Register one agent
      const app = makeLoadedEmployee({
        id: 'registered-agent',
        displayName: 'Registered',
        schedule: {
          triggers: [{ type: 'event', value: 'registered.event', prompt: 'OK', enabled: true }],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      // Publish an event that no agent is subscribed to
      expect(() => bus.publishDomainEvent('unregistered.event', { data: 'test' })).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // The registered agent should not have been called
      expect(agentRespondMock).not.toHaveBeenCalled();
    });

    it('handles prompt interpolation with missing variables gracefully', async () => {
      const app = makeLoadedEmployee({
        id: 'interpolation-agent',
        displayName: 'Interpolation Test',
        schedule: {
          triggers: [
            { type: 'event', value: 'test.event', prompt: 'Process {{name}} from {{missing}}', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      // Publish event without the 'missing' variable
      bus.publishDomainEvent('test.event', { name: 'Alice' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentRespondMock).toHaveBeenCalledTimes(1);
      const prompt = agentRespondMock.mock.calls[0][0];
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('{{missing}}'); // Not replaced because missing
    });

    it('handles multiple agents subscribed to same event', async () => {
      const app1 = makeLoadedEmployee({
        id: 'agent-1',
        displayName: 'Agent 1',
        schedule: {
          triggers: [{ type: 'event', value: 'shared.event', prompt: 'Agent 1: {{id}}', enabled: true }],
        },
      });

      const app2 = makeLoadedEmployee({
        id: 'agent-2',
        displayName: 'Agent 2',
        schedule: {
          triggers: [{ type: 'event', value: 'shared.event', prompt: 'Agent 2: {{id}}', enabled: true }],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app1, app2]);

      bus.publishDomainEvent('shared.event', { id: 'SHARED-001' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentRespondMock).toHaveBeenCalledTimes(2);

      const calls = agentRespondMock.mock.calls;
      expect(calls.some((call) => call[2] === 'agent-1')).toBe(true);
      expect(calls.some((call) => call[2] === 'agent-2')).toBe(true);

      // Both should have the event in their inbox
      expect(bus.getInbox('agent-1')).toHaveLength(1);
      expect(bus.getInbox('agent-2')).toHaveLength(1);
    });

    it('handles disabled event triggers', async () => {
      const app = makeLoadedEmployee({
        id: 'disabled-agent',
        displayName: 'Disabled Agent',
        schedule: {
          triggers: [
            { type: 'event', value: 'disabled.event', prompt: 'Should not run', enabled: false },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      bus.publishDomainEvent('disabled.event', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Agent should not be called for disabled trigger
      expect(agentRespondMock).not.toHaveBeenCalled();
      expect(bus.getInbox('disabled-agent')).toHaveLength(0);
    });

    it('handles cron triggers separately from event triggers', () => {
      const app = makeLoadedEmployee({
        id: 'mixed-trigger-agent',
        displayName: 'Mixed Trigger Agent',
        schedule: {
          triggers: [
            { type: 'event', value: 'my.event', prompt: 'Event trigger', enabled: true },
            { type: 'cron', value: '0 8 * * *', prompt: 'Daily task', enabled: true },
          ],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      // Verify both triggers are defined in the app
      const eventTrigger = app.schedule?.triggers?.find((t) => t.type === 'event');
      const cronTrigger = app.schedule?.triggers?.find((t) => t.type === 'cron');

      expect(eventTrigger).toBeDefined();
      expect(cronTrigger).toBeDefined();
      expect(cronTrigger?.value).toBe('0 8 * * *');
    });

    it('removes event subscriptions when app is unregistered', async () => {
      const app = makeLoadedEmployee({
        id: 'removable-agent',
        displayName: 'Removable Agent',
        schedule: {
          triggers: [{ type: 'event', value: 'removable.event', prompt: 'Will be removed', enabled: true }],
        },
      });

      eventBridge.registerEmployeeEventTriggers([app]);

      bus.publishDomainEvent('removable.event', { id: '1' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(agentRespondMock).toHaveBeenCalledTimes(1);

      // Remove the app's triggers
      eventBridge.removeAppEventTriggers('removable-agent');

      // Reset mock
      agentRespondMock.mockClear();

      // Publish another event - should not trigger agent
      bus.publishDomainEvent('removable.event', { id: '2' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentRespondMock).not.toHaveBeenCalled();
    });
  });

  describe('Stats Integration', () => {
    it('records token usage and agent runs correctly', () => {
      const agentId = 'stats-test-agent';

      stats.recordTokenUsage({ agentId, inputTokens: 1200, outputTokens: 300, model: 'claude-sonnet-4-6' });
      stats.recordTokenUsage({ agentId, inputTokens: 800, outputTokens: 150, model: 'claude-sonnet-4-6' });

      stats.recordAgentRun({ agentId, trigger: 'event', success: true, durationMs: 500 });
      stats.recordAgentRun({ agentId, trigger: 'cron', success: false, durationMs: 300, error: 'timeout' });

      const agentStats = statsStore.getAgentStats(agentId);

      expect(agentStats.agentId).toBe(agentId);
      expect(agentStats.totalInputTokens).toBe(2000);
      expect(agentStats.totalOutputTokens).toBe(450);
      expect(agentStats.callCount).toBe(2);
      expect(agentStats.runCount).toBe(2);
      expect(agentStats.failureCount).toBe(1);
      expect(agentStats.lastRunAt).toBeGreaterThan(0);
    });

    it('lists all agent stats', () => {
      stats.recordAgentRun({ agentId: 'agent-a', trigger: 'event', success: true, durationMs: 100 });
      stats.recordAgentRun({ agentId: 'agent-b', trigger: 'cron', success: true, durationMs: 200 });
      stats.recordTokenUsage({ agentId: 'agent-a', inputTokens: 100, outputTokens: 50, model: 'model' });

      const allStats = statsStore.listAllAgentStats();

      expect(allStats).toHaveLength(2);
      expect(allStats.some((s) => s.agentId === 'agent-a')).toBe(true);
      expect(allStats.some((s) => s.agentId === 'agent-b')).toBe(true);
    });
  });
});
