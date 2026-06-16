import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageBus } from '../src/bus.js';
import { MessageIngressRuntime } from '../src/ingress/runtime.js';
import { TaskScheduler } from '../src/scheduler.js';
import { MessageStore } from '../src/store.js';
import type { AgentFactory, RespondOptions } from '../src/bot.js';

class AcmeMaintenanceAgent implements AgentFactory {
  readonly calls: Array<{ prompt: string; chatId: string; botName: string; opts?: RespondOptions }> = [];

  async respond(prompt: string, chatId: string, botName: string, opts?: RespondOptions): Promise<string> {
    this.calls.push({ prompt, chatId, botName, opts });

    opts?.onRoutingDecision?.({
      mode: 'employee-director',
      selectedEmployee: 'finance-wangwu',
      selectorShown: false,
    });
    opts?.onMemoryOp?.({
      operation: 'search',
      subject: '江山市人民医院 GE16排 CT 半年维保历史',
      workspace: 'acme-happycompany',
      status: 'ok',
    });
    opts?.onToolStart?.({
      toolName: 'med_crm:list_maintenance',
      toolUseId: 'tool-maintenance-list',
      toolInput: {
        hospitalName: '江山市人民医院',
        device: 'GE16排 CT',
      },
    });
    opts?.onToolEnd?.({
      toolName: 'med_crm:list_maintenance',
      toolUseId: 'tool-maintenance-list',
      elapsedMs: 24,
    });
    opts?.onBusinessArtifact?.({
      type: 'maintenance_task',
      id: 'task-jsrm-ge16ct-2026h2',
      status: 'triggered',
    });
    opts?.onHandoff?.({
      from: 'finance-wangwu',
      to: 'maintenance-lisi',
      reason: '维修定时任务触发，需要现场维修数字员工查阅说明书并记录回执',
    });
    opts?.onToolStart?.({
      toolName: 'manuals:lookup',
      toolUseId: 'tool-manual-lookup',
      toolInput: {
        model: 'GE16排 CT',
        fault: '半年维保',
      },
    });
    opts?.onToolEnd?.({
      toolName: 'manuals:lookup',
      toolUseId: 'tool-manual-lookup',
      elapsedMs: 31,
    });
    opts?.onToolStart?.({
      toolName: 'med_crm:create_service_record',
      toolUseId: 'tool-service-record',
      toolInput: {
        taskId: 'task-jsrm-ge16ct-2026h2',
        hospitalName: '江山市人民医院',
        result: '完成半年维保，已记录现场情况和回执',
      },
    });
    opts?.onToolEnd?.({
      toolName: 'med_crm:create_service_record',
      toolUseId: 'tool-service-record',
      elapsedMs: 45,
    });
    opts?.onBusinessArtifact?.({
      type: 'service_record',
      id: 'svc-jsrm-ge16ct-2026h2',
      status: 'created',
    });
    opts?.onBusinessArtifact?.({
      type: 'finance_settlement',
      id: 'settle-jsrm-ge16ct-2026h2',
      status: 'created',
    });

    return '已触发江山市人民医院 GE16排 CT 半年维保派单，维修记录和回执已反馈财务。';
  }

  clearSession(): boolean {
    return true;
  }

  clearAllSessions(): number {
    return 0;
  }

  listSessions(): string[] {
    return [];
  }
}

describe('Acme scheduler runtime acceptance', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.();
    }
  });

  it('triggers the maintenance schedule through ingress runtime and persists handoff, tools, memory, and business artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-scheduler-runtime-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

    let idCounter = 0;
    let now = 1_780_000_000_000;
    const store = new MessageStore(join(dir, 'messages.db'));
    const bus = new MessageBus();
    const agentFactory = new AcmeMaintenanceAgent();
    const runtime = new MessageIngressRuntime({
      agentFactory,
      store,
      bus,
      clock: () => {
        now += 10;
        return now;
      },
      idGenerator: () => `id-${idCounter += 1}`,
    });

    const scheduler = new TaskScheduler(store, {
      async respond(prompt, chatId, botName) {
        await runtime.handle({
          channel: 'harness',
          botName,
          tenant: 'acme-happycompany',
          entryId: 'scheduler',
          actorId: 'system-maintenance-clock',
          sessionId: `acme-happycompany:${chatId}`,
          employeeId: botName,
          instanceId: `acme-happycompany:system-maintenance-clock:${botName}`,
          workdir: '/corp/acme-happycompany/agents/finance-wangwu/system-maintenance-clock',
          sdkSessionScope: `acme-happycompany:scheduler:${chatId}:${botName}`,
          mode: 'workflow_group',
          userId: 'system-maintenance-clock',
          chatId,
          text: prompt,
        });
        return 'ok';
      },
    });

    const task = scheduler.createTask({
      name: '江山市人民医院 GE16排 CT 半年维保',
      botName: 'finance-wangwu',
      scheduleType: 'once',
      scheduleValue: new Date(now + 60_000).toISOString(),
      prompt: '维修定时任务触发：江山市人民医院 GE16排 CT 进入半年维保窗口，请财务派单维修数字员工，查阅说明书，记录实际情况、维修日志和回执。',
    });

    const result = await scheduler.triggerTask(task.id);

    expect(result).toEqual({ success: true });
    expect(agentFactory.calls).toHaveLength(1);
    expect(agentFactory.calls[0]).toEqual(expect.objectContaining({
      chatId: `__scheduled__:${task.id}`,
      botName: 'finance-wangwu',
    }));
    expect(agentFactory.calls[0].prompt).toContain('维修定时任务触发');

    const updatedTask = store.getTask(task.id);
    expect(updatedTask).toEqual(expect.objectContaining({
      enabled: false,
      runCount: 1,
      nextRunAt: null,
    }));
    expect(updatedTask?.lastRunAt).toEqual(expect.any(Number));

    const messages = store.getMessagesForChat(`__scheduled__:${task.id}`, 20);
    expect(messages.map((message) => message.source).sort()).toEqual(['bot', 'user']);
    expect(messages.find((message) => message.source === 'bot')?.text).toContain('回执已反馈财务');

    const events = store.listRuntimeEvents({
      sessionId: `acme-happycompany:__scheduled__:${task.id}`,
    });
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'routing_decision',
      'memory_op',
      'tool_call_started',
      'tool_call_completed',
      'business_artifact',
      'handoff_requested',
      'tool_call_started',
      'tool_call_completed',
      'tool_call_started',
      'tool_call_completed',
      'business_artifact',
      'business_artifact',
      'agent_message',
    ]);
    expect(events.find((event) => event.type === 'handoff_requested')?.payload).toEqual(expect.objectContaining({
      fromEmployeeId: 'finance-wangwu',
      toEmployeeId: 'maintenance-lisi',
    }));
    expect(events.filter((event) => event.type === 'business_artifact').map((event) => event.payload)).toEqual([
      expect.objectContaining({ type: 'maintenance_task', id: 'task-jsrm-ge16ct-2026h2', status: 'triggered' }),
      expect.objectContaining({ type: 'service_record', id: 'svc-jsrm-ge16ct-2026h2', status: 'created' }),
      expect.objectContaining({ type: 'finance_settlement', id: 'settle-jsrm-ge16ct-2026h2', status: 'created' }),
    ]);
    expect(events.filter((event) => event.type === 'tool_call_completed').map((event) => event.payload.toolName)).toEqual([
      'med_crm:list_maintenance',
      'manuals:lookup',
      'med_crm:create_service_record',
    ]);
  });
});
