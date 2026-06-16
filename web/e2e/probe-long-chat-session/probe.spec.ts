import { test, expect, type Page, type Route } from '@playwright/test';
import { mockAuth, mockWebSocket, setupToken } from '../helpers';

type MockWsHandle = {
  sentMessages: string[];
  receiveMessage: (msg: Record<string, unknown>) => void;
};

type SendPayload = {
  type: 'send_message';
  workdirId: string;
  tenant?: string;
  chatId: string;
  content: string;
};

type LegacyHistoryMessage = {
  id: string;
  chat_id: string;
  text: string;
  source: 'user' | 'bot';
  bot_name: string | null;
  timestamp: number;
};

const tenantId = 'acme-happycompany';
const workdirId = 'web-bot';
const baseTime = Date.parse('2026-06-04T09:00:00+08:00');

function buildHistory(start: number, end: number): LegacyHistoryMessage[] {
  const messages: LegacyHistoryMessage[] = [];
  for (let index = start; index <= end; index += 1) {
    const source = index % 2 === 0 ? 'bot' : 'user';
    messages.push({
      id: `history-${index}`,
      chat_id: 'will-be-overridden-by-current-chat',
      text: source === 'bot'
        ? `历史第 ${index} 条：示例医疗业务助手回复了上下文摘要`
        : `历史第 ${index} 条：客户追问了报价和履约状态`,
      source,
      bot_name: source === 'bot' ? workdirId : null,
      timestamp: baseTime + index * 60_000,
    });
  }
  return messages;
}

async function setupLongChatMocks(page: Page, state: { olderHistoryRequested: boolean }): Promise<void> {
  await mockWebSocket(page);
  mockAuth(page, [{ name: workdirId, displayName: 'Web 入口' }]);
  await setupToken(page);

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ json: { authenticated: true, user: { name: 'Probe Admin' } } });
  });

  await page.route('**/api/tenants', async (route) => {
    await route.fulfill({
      json: {
        tenants: [
          { id: tenantId, displayName: '示例医疗 HappyCompany', description: '长会话 Probe 租户' },
        ],
      },
    });
  });

  await page.route('**/api/workdirs', async (route) => {
    await route.fulfill({
      json: [
        {
          id: workdirId,
          displayName: 'Web 入口',
          path: 'agents/web-bot',
          channels: ['web'],
          status: 'running',
          tenant: tenantId,
        },
      ],
    });
  });

  await page.route('**/api/web-chat/config', async (route) => {
    await route.fulfill({
      json: {
        welcomeTitle: '长会话 Probe',
        welcomeSubtitle: '验证历史、流式、协同和多轮输入。',
        inputPlaceholder: '输入消息... (Enter 发送)',
        historyLimit: 10,
        enableImageUpload: false,
        showSessionPicker: true,
        showQuickPrompts: false,
      },
    });
  });

  await page.route('**/api/runtime/entries**', async (route) => {
    await route.fulfill({ json: { entries: [] } });
  });

  await page.route(`**/api/workdir/${workdirId}/sessions`, async (route) => {
    await route.fulfill({ json: { sessions: [] } });
  });

  await page.route(`**/api/chat/${workdirId}/history**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const chatId = url.searchParams.get('chatId') || workdirId;
    const rawHistory = url.searchParams.has('before')
      ? buildHistory(1, 10)
      : buildHistory(11, 20);
    if (url.searchParams.has('before')) {
      state.olderHistoryRequested = true;
    }
    await route.fulfill({
      json: {
        data: rawHistory.map((message) => ({
          ...message,
          chat_id: chatId,
        })),
      },
    });
  });
}

async function lastSendPayload(page: Page): Promise<SendPayload> {
  return page.evaluate(() => {
    const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
    const raw = [...ws.sentMessages]
      .reverse()
      .find((item) => JSON.parse(item).type === 'send_message');
    if (!raw) throw new Error('send_message frame not found');
    return JSON.parse(raw) as SendPayload;
  });
}

async function sentPayloads(page: Page): Promise<SendPayload[]> {
  return page.evaluate(() => {
    const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
    return ws.sentMessages
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .filter((item): item is SendPayload => item.type === 'send_message');
  });
}

async function receiveWsEvent(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
    ws.receiveMessage(payload);
  }, event);
}

async function scrollMessageList(page: Page, top: number): Promise<void> {
  await page.evaluate((scrollTop) => {
    const scrollers = Array.from(document.querySelectorAll<HTMLElement>('div.h-full.overflow-y-auto'));
    const messageList = scrollers.find((element) => element.textContent?.includes('历史第 20 条'))
      ?? scrollers[scrollers.length - 1];
    if (!messageList) throw new Error('message list scroller not found');
    messageList.scrollTop = scrollTop;
    messageList.dispatchEvent(new Event('scroll'));
  }, top);
}

test.describe('Probe: long chat session interactions', () => {
  test('keeps one chat context across history pagination, streaming, handoff, and repeated turns', async ({ page }) => {
    const routeState = { olderHistoryRequested: false };
    await setupLongChatMocks(page, routeState);

    await page.goto(`/chat/${workdirId}`);
    await expect(page.getByText('已连接', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('历史第 20 条：示例医疗业务助手回复了上下文摘要')).toBeVisible({ timeout: 5000 });

    await scrollMessageList(page, 0);
    await expect.poll(() => routeState.olderHistoryRequested, { timeout: 5000 }).toBe(true);
    await scrollMessageList(page, 0);
    await expect(page.getByText('历史第 1 条：客户追问了报价和履约状态')).toBeVisible({ timeout: 5000 });

    const textarea = page.getByPlaceholder('输入消息... (Enter 发送)');
    const chatIds = new Set<string>();

    for (let turn = 1; turn <= 8; turn += 1) {
      const userText = `长会话第 ${turn} 轮：继续沿用前文报价、履约和协同上下文`;
      await textarea.fill(userText);
      await textarea.press('Enter');

      await expect.poll(async () => (await lastSendPayload(page)).content).toBe(userText);
      const payload = await lastSendPayload(page);
      expect(payload.workdirId).toBe(workdirId);
      expect(payload.tenant).toBe(tenantId);
      chatIds.add(payload.chatId);

      await receiveWsEvent(page, {
        type: 'new_message',
        botName: payload.workdirId,
        chatId: payload.chatId,
        message: {
          id: `user-turn-${turn}`,
          chatId: payload.chatId,
          text: payload.content,
          source: 'user',
          botName: payload.workdirId,
          timestamp: baseTime + (30 + turn * 2) * 60_000,
        },
      });

      if (turn === 3) {
        await receiveWsEvent(page, {
          type: 'stream_event',
          botName: payload.workdirId,
          chatId: payload.chatId,
          event: {
            eventType: 'handoff',
            handoffFrom: 'web-bot',
            handoffTo: 'finance-lisi',
            handoffReason: '确认长会话中的报价权限',
            contractId: 'long-chat-child-1',
            parentContractId: 'long-chat-parent-1',
          },
        });
        await expect(page.getByText('协同处理中')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('finance-lisi')).toBeVisible();

        await receiveWsEvent(page, {
          type: 'stream_event',
          botName: payload.workdirId,
          chatId: payload.chatId,
          event: {
            eventType: 'handoff_result',
            handoffTo: 'finance-lisi',
            handoffStatus: 'completed',
            handoffResult: '财务李四确认：本轮报价可沿用前文审批结论。',
            contractId: 'long-chat-child-1',
            parentContractId: 'long-chat-parent-1',
          },
        });
        await expect(page.getByText('财务李四确认：本轮报价可沿用前文审批结论。')).toBeVisible({ timeout: 5000 });
      }

      if (turn === 5) {
        await receiveWsEvent(page, {
          type: 'stream_event',
          botName: payload.workdirId,
          chatId: payload.chatId,
          event: { eventType: 'text_delta', text: '流式片段 A' },
        });
        await receiveWsEvent(page, {
          type: 'stream_event',
          botName: payload.workdirId,
          chatId: payload.chatId,
          event: { eventType: 'text_delta', text: '流式片段 B' },
        });
        await expect(page.getByText('流式片段 A流式片段 B')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('流式片段 A流式片段 A流式片段 B')).toHaveCount(0);
      }

      const botText = turn === 5
        ? '流式片段 A流式片段 B'
        : `长会话第 ${turn} 轮回复：已保留前文报价、履约和协同上下文`;
      await receiveWsEvent(page, {
        type: 'new_message',
        botName: payload.workdirId,
        chatId: payload.chatId,
        message: {
          id: `bot-turn-${turn}`,
          chatId: payload.chatId,
          text: botText,
          source: 'bot',
          botName: payload.workdirId,
          timestamp: baseTime + (31 + turn * 2) * 60_000,
        },
      });
      await expect(page.getByText(botText).last()).toBeVisible({ timeout: 5000 });
    }

    const frames = await sentPayloads(page);
    expect(frames).toHaveLength(8);
    expect(chatIds.size).toBe(1);
    await expect(textarea).toBeEnabled();
    await expect(page.getByText('长会话第 8 轮回复：已保留前文报价、履约和协同上下文')).toBeVisible();
  });
});
