import { test, expect, type Page } from '@playwright/test';
import { mockWebSocket } from '../helpers';
import { createJourneyReport } from '../reporting';
import {
  probeEmployee,
  probeHandoffEmployee,
  probeHandoffSession,
  probePerson,
  probeTenant,
  setupProbeConsole,
} from '../probe-helpers';

async function emitHandoffStart(page: Page): Promise<void> {
  await page.evaluate((payload) => {
    const ws = (window as unknown as { __mockWs?: { receiveMessage: (msg: Record<string, unknown>) => void } }).__mockWs;
    ws?.receiveMessage({
      type: 'new_message',
      chatId: payload.chatId,
      message: {
        id: 'handoff-live-user',
        chatId: payload.chatId,
        source: 'user',
        text: '客户问 CT 设备维保状态，需要销售转维修核验',
        botName: payload.fromEmployeeId,
        timestamp: Date.now(),
        tenant: payload.tenant,
        entryId: payload.entryId,
        actorId: payload.actorId,
      },
      meta: payload,
    });
    ws?.receiveMessage({
      type: 'stream_event',
      botName: payload.fromEmployeeId,
      chatId: payload.chatId,
      event: {
        eventType: 'handoff',
        handoffFrom: payload.fromEmployeeId,
        handoffTo: payload.toEmployeeId,
        handoffReason: '需要确认设备维保记录',
        contractId: 'handoff-contract-1',
      },
      meta: payload,
    });
  }, {
    tenant: probeTenant.id,
    entryId: 'web-bot',
    actorId: probePerson.userId,
    fromEmployeeId: probeEmployee.id,
    toEmployeeId: probeHandoffEmployee.id,
    sessionId: probeHandoffSession.id,
    chatId: 'chat-live-handoff-maintenance',
  });
}

async function emitHandoffResult(page: Page): Promise<void> {
  await page.evaluate((payload) => {
    const ws = (window as unknown as { __mockWs?: { receiveMessage: (msg: Record<string, unknown>) => void } }).__mockWs;
    ws?.receiveMessage({
      type: 'stream_event',
      botName: payload.fromEmployeeId,
      chatId: payload.chatId,
      event: {
        eventType: 'handoff_result',
        handoffTo: payload.toEmployeeId,
        handoffStatus: 'completed',
        handoffResult: '维修李四确认：GE16排 CT 维保有效期到 2026-12-31。',
        contractId: 'handoff-contract-1',
      },
      meta: payload,
    });
    ws?.receiveMessage({
      type: 'new_message',
      chatId: payload.chatId,
      message: {
        id: 'handoff-live-bot',
        chatId: payload.chatId,
        source: 'bot',
        text: '已协同维修李四核验：GE16排 CT 维保有效期到 2026-12-31，可以继续推进续保报价。',
        botName: payload.fromEmployeeId,
        timestamp: Date.now(),
        tenant: payload.tenant,
        entryId: payload.entryId,
        actorId: payload.actorId,
        observability: {
          summary: { status: 'completed', stopReason: 'end_turn', errors: [], permissionDenials: [] },
          init: {
            sessionId: 'sdk-handoff-journey',
            model: 'claude-sonnet-4-6',
            cwd: '/corp/acme-happycompany/agents/sales-zhangsan',
            tools: ['handoff', 'maintenance_records:lookup'],
            mcpServers: [{ name: 'platform-runtime', status: 'connected' }],
            skills: ['handoff'],
            plugins: [],
            permissionMode: 'bypassPermissions',
            claudeCodeVersion: '2.0.0',
          },
          usage: {
            inputTokens: 680,
            outputTokens: 220,
            cacheReadInputTokens: 120,
            cacheCreationInputTokens: 40,
            costUSD: 0.018,
            durationMs: 3200,
            apiDurationMs: 2800,
            numTurns: 2,
          },
          toolCalls: [{ toolName: 'maintenance_records:lookup', toolUseId: 'tool-maintenance-1', elapsedMs: 430, status: 'completed' }],
          handoffs: [{
            from: payload.fromEmployeeId,
            to: payload.toEmployeeId,
            status: 'completed',
            reason: '需要确认设备维保记录',
            result: '维修李四确认：GE16排 CT 维保有效期到 2026-12-31。',
          }],
          startedAt: Date.now() - 3200,
          finishedAt: Date.now(),
        },
      },
      meta: payload,
    });
  }, {
    tenant: probeTenant.id,
    entryId: 'web-bot',
    actorId: probePerson.userId,
    fromEmployeeId: probeEmployee.id,
    toEmployeeId: probeHandoffEmployee.id,
    chatId: 'chat-live-handoff-maintenance',
  });
}

test('captures chat collaboration handoff journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'chat-collaboration-handoff',
    title: 'Chat Collaboration Handoff Journey',
    note: '从 Web Chat 发起业务请求，观察销售员工 handoff 给维修员工，并在协同日志中复盘轨迹。',
  });

  await mockWebSocket(page);
  await setupProbeConsole(page);

  const liveChatId = 'chat-live-handoff-maintenance';
  await page.goto(`/chat?tenant=${probeTenant.id}&entry=web-bot&actor=${probePerson.userId}&employee=${probeEmployee.id}&chat=${liveChatId}`);
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  await expect(page.getByText('将发送给 销售张三')).toBeVisible();
  await report.capture(page, 'chat-ready', 'Chat 已选择销售数字员工');

  await page.getByPlaceholder('输入业务请求...').fill('客户问 CT 设备维保状态，需要销售转维修核验');
  await page.keyboard.press('Enter');
  await emitHandoffStart(page);
  await expect(page.getByText('协同处理中')).toBeVisible();
  await expect(page.getByText(probeHandoffEmployee.id)).toBeVisible();
  await report.capture(page, 'handoff-processing', 'Chat 展示员工协同处理中');

  await emitHandoffResult(page);
  await expect(page.getByText('已协同维修李四核验：GE16排 CT 维保有效期到 2026-12-31，可以继续推进续保报价。')).toBeVisible();
  await report.capture(page, 'handoff-result', 'Chat 展示员工协同结果');

  await expect(page.getByText('运行看板')).toBeVisible();
  await page.getByText('运行看板').click();
  await expect(page.getByText('协同交接')).toBeVisible();
  await expect(page.getByText('maintenance_records:lookup').first()).toBeVisible();
  await report.capture(page, 'observability-board', '运行看板展示 handoff 与工具调用');

  await page.goto('/orchestration');
  await expect(page.getByRole('heading', { name: '协同日志' })).toBeVisible();
  await expect(page.getByText('客户问 CT 设备维保状态，需要销售转维修核验').first()).toBeVisible();
  await expect(page.getByText('员工协同')).toBeVisible();
  await expect(page.getByText('maintenance_records:lookup').first()).toBeVisible();
  await report.capture(page, 'orchestration-review', '协同日志复盘 handoff 时间线');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证 Chat 中的 handoff 过程、协同结果、运行看板和 Orchestration 时间线。',
      '本 Journey 使用显式 API/WebSocket mock，重点覆盖交互状态和事后复盘可见性。',
    ],
  });
});
