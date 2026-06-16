import { test, expect } from '@playwright/test';
import { mockAuth, mockWebSocket, setupToken } from '../helpers';

type MockWsHandle = {
  sentMessages: string[];
  receiveMessage: (msg: Record<string, unknown>) => void;
  simulateDisconnect: () => void;
};

function getSendPayloadScript() {
  return () => {
    const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
    const raw = ws.sentMessages.find((item) => JSON.parse(item).type === 'send_message');
    if (!raw) throw new Error('send_message frame not found');
    return JSON.parse(raw) as { workdirId: string; chatId: string; content: string };
  };
}

async function openChat(page: import('@playwright/test').Page): Promise<void> {
  await mockWebSocket(page);
  mockAuth(page);
  await setupToken(page);
  await page.goto('/chat');
  await expect(page.getByText('已连接', { exact: true })).toBeVisible({ timeout: 5000 });
}

test.describe('Story Q: Chat WebSocket protocol', () => {
  test('WebSocket connects and shows connected status', async ({ page }) => {
    await openChat(page);
  });

  test('send message renders only after backend new_message', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('Hello from test');
    await textarea.press('Enter');
    await expect(page.getByText('Hello from test')).toHaveCount(0);

    await page.evaluate(() => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      const raw = ws.sentMessages.find((item) => JSON.parse(item).type === 'send_message');
      if (!raw) throw new Error('send_message frame not found');
      const msg = JSON.parse(raw) as { workdirId: string; chatId: string; content: string };
      ws.receiveMessage({
        type: 'new_message',
        botName: msg.workdirId,
        chatId: msg.chatId,
        message: {
          id: 'user-msg-1',
          chatId: msg.chatId,
          text: msg.content,
          source: 'user',
          botName: msg.workdirId,
          timestamp: Date.now(),
        },
      });
    });

    await expect(page.getByText('Hello from test')).toBeVisible();
    await expect(textarea).toHaveValue('');
  });

  test('stream_event deltas render and final new_message clears streaming block', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('Trigger reply');
    await textarea.press('Enter');

    const msg = await page.evaluate(getSendPayloadScript());
    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'stream_event',
        botName: payload.workdirId,
        chatId: payload.chatId,
        event: { eventType: 'text_delta', text: 'Hello' },
      });
      ws.receiveMessage({
        type: 'stream_event',
        botName: payload.workdirId,
        chatId: payload.chatId,
        event: { eventType: 'text_delta', text: ' world' },
      });
    }, msg);

    await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('HelloHello world')).toHaveCount(0);

    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'new_message',
        botName: payload.workdirId,
        chatId: payload.chatId,
        message: {
          id: 'bot-msg-1',
          chatId: payload.chatId,
          text: 'Hello world',
          source: 'bot',
          botName: payload.workdirId,
          timestamp: Date.now(),
        },
      });
    }, msg);

    await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });
  });

  test('handoff stream events show delegated result before final reply', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('需要协同查询维保状态');
    await textarea.press('Enter');

    const msg = await page.evaluate(getSendPayloadScript());
    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'stream_event',
        botName: payload.workdirId,
        chatId: payload.chatId,
        event: {
          eventType: 'handoff',
          handoffFrom: 'sales-zhangsan',
          handoffTo: 'maintenance-lisi',
          handoffReason: '查询设备维保状态',
          contractId: 'child-contract-1',
          parentContractId: 'parent-contract-1',
        },
      });
    }, msg);

    await expect(page.getByText('协同处理中')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('maintenance-lisi')).toBeVisible();
    await expect(page.getByText('处理中', { exact: true })).toBeVisible();

    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'stream_event',
        botName: payload.workdirId,
        chatId: payload.chatId,
        event: {
          eventType: 'handoff_result',
          handoffTo: 'maintenance-lisi',
          handoffStatus: 'completed',
          handoffResult: '维修李四确认：设备维保有效期到 2026-12-31。',
          contractId: 'child-contract-1',
          parentContractId: 'parent-contract-1',
        },
      });
    }, msg);

    await expect(page.getByText('已完成')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('协同结果')).toBeVisible();
    await expect(page.getByText('维修李四确认：设备维保有效期到 2026-12-31。')).toBeVisible();
  });

  test('bot replies expose expandable observability board', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('Run observed reply');
    await textarea.press('Enter');

    const msg = await page.evaluate(getSendPayloadScript());
    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'new_message',
        botName: payload.workdirId,
        chatId: payload.chatId,
        message: {
          id: 'bot-observed-1',
          chatId: payload.chatId,
          text: '已完成观测回复',
          source: 'bot',
          botName: payload.workdirId,
          timestamp: Date.now(),
          observability: {
            summary: { status: 'completed', stopReason: 'end_turn', errors: [], permissionDenials: [] },
            init: {
              sessionId: 'sdk-session-e2e',
              model: 'claude-e2e',
              cwd: '/tmp/agent',
              tools: ['Read', 'handoff'],
              mcpServers: [{ name: 'tenant-tools', status: 'connected' }],
              skills: ['handoff'],
              plugins: [],
              permissionMode: 'bypassPermissions',
              claudeCodeVersion: '1.2.3',
            },
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadInputTokens: 10,
              cacheCreationInputTokens: 5,
              costUSD: 0.0123,
              durationMs: 1500,
              apiDurationMs: 1200,
              numTurns: 2,
            },
            toolCalls: [{ toolName: 'Read', toolUseId: 'tool-1', elapsedMs: 42, status: 'completed' }],
            handoffs: [{ from: 'sales-zhangsan', to: 'maintenance-lisi', status: 'completed', result: '维保有效' }],
            startedAt: Date.now() - 1500,
            finishedAt: Date.now(),
          },
        },
      });
    }, msg);

    await expect(page.getByText('运行看板')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('claude-e2e')).toBeVisible();
    await page.getByText('运行看板').click();
    await expect(page.getByText('输入 tokens')).toBeVisible();
    await expect(page.getByText('工具调用')).toBeVisible();
    await expect(page.getByText('协同交接')).toBeVisible();
    await expect(page.getByText('维保有效')).toBeVisible();
  });

  test('new_message error renders as bot message', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('Cause error');
    await textarea.press('Enter');

    const msg = await page.evaluate(getSendPayloadScript());
    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'new_message',
        botName: payload.workdirId,
        chatId: payload.chatId,
        message: {
          id: 'err-msg-1',
          chatId: payload.chatId,
          text: '[Error] Model overloaded',
          source: 'bot',
          botName: payload.workdirId,
          timestamp: Date.now(),
        },
      });
    }, msg);

    await expect(page.getByText('[Error] Model overloaded')).toBeVisible({ timeout: 5000 });
  });

  test('disconnect shows disconnected then reconnects', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as unknown as { __mockWs: MockWsHandle }).__mockWs.simulateDisconnect();
    });

    await expect(page.getByText('已断开', { exact: true })).toBeVisible({ timeout: 2000 });
    await expect(page.getByText('已连接', { exact: true })).toBeVisible({ timeout: 6000 });
  });

  test('streaming response shows stop button', async ({ page }) => {
    await openChat(page);

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    await textarea.fill('Start stream');
    await textarea.press('Enter');

    const msg = await page.evaluate(getSendPayloadScript());
    await page.evaluate((payload) => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      ws.receiveMessage({
        type: 'stream_event',
        botName: payload.workdirId,
        chatId: payload.chatId,
        event: { eventType: 'text_delta', text: 'Thinking...' },
      });
    }, msg);

    await expect(page.getByTitle('停止')).toBeVisible({ timeout: 5000 });
  });
});
