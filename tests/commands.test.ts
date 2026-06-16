import { describe, it, expect, vi } from 'vitest';
import { createCommandHandler } from '../src/commands.js';
import type { BotInfo } from '../src/command-utils.js';

const MOCK_BOTS: BotInfo[] = [
  { name: 'hospital-crm-bot', displayName: '医院CRM助手', channel: 'feishu', sessionCount: 3 },
  { name: 'dingtalk-bot', displayName: '钉钉Bot', channel: 'dingtalk', sessionCount: 0 },
];

function createTestFixture(getRecentMessages?: (chatId: string, limit: number) => Array<{ text: string; source: string; timestamp: number }>) {
  const clearSession = vi.fn<(botName: string, chatId: string) => boolean>().mockReturnValue(true);
  const getBots = vi.fn<() => BotInfo[]>().mockReturnValue(MOCK_BOTS);
  const handler = createCommandHandler(getBots, clearSession, getRecentMessages);

  return { handler, clearSession, getBots, getRecentMessages };
}

describe('createCommandHandler', () => {
  describe('non-command input returns null', () => {
    it('returns null for empty string', async () => {
      const { handler } = createTestFixture();
      expect(await handler('hospital-crm-bot', 'chat1', '')).toBeNull();
    });

    it('returns null for whitespace-only string', async () => {
      const { handler } = createTestFixture();
      expect(await handler('hospital-crm-bot', 'chat1', '   ')).toBeNull();
    });

    it('returns null for text without leading slash', async () => {
      const { handler } = createTestFixture();
      expect(await handler('hospital-crm-bot', 'chat1', 'hello')).toBeNull();
    });

    it('returns null for regular message', async () => {
      const { handler } = createTestFixture();
      expect(await handler('hospital-crm-bot', 'chat1', '你好，请问一下')).toBeNull();
    });
  });

  describe('/clear', () => {
    it('calls clearSession and returns confirmation', async () => {
      const { handler, clearSession } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/clear');
      expect(result).toBe('会话已清除');
      expect(clearSession).toHaveBeenCalledWith('hospital-crm-bot', 'chat1');
    });

    it('ignores trailing arguments', async () => {
      const { handler, clearSession } = createTestFixture();
      await handler('hospital-crm-bot', 'chat1', '/clear extra stuff');
      expect(clearSession).toHaveBeenCalledWith('hospital-crm-bot', 'chat1');
    });
  });

  describe('/list', () => {
    it('returns formatted bot list with /list', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/list');
      expect(result).toContain('hospital-crm-bot');
      expect(result).toContain('dingtalk-bot');
      expect(result).toContain('3 sessions');
      expect(result).toContain('0 sessions');
    });

    it('returns formatted bot list with /ls alias', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/ls');
      expect(result).toContain('hospital-crm-bot');
    });

    it('marks current bot with > prefix', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/list');
      const lines = result!.split('\n');
      expect(lines[0]).toMatch(/^> /);
      expect(lines[1]).toMatch(/^  /);
    });
  });

  describe('/status', () => {
    it('returns current bot status', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/status');
      expect(result).toContain('Bot: hospital-crm-bot');
      expect(result).toContain('Display: 医院CRM助手');
      expect(result).toContain('Channel: feishu');
      expect(result).toContain('Sessions: 3');
    });

    it('returns not-found message for unknown bot name', async () => {
      const { handler } = createTestFixture();
      const result = await handler('unknown-bot', 'chat1', '/status');
      expect(result).toBe('未找到当前 Bot 信息');
    });
  });

  describe('/recall', () => {
    it('returns "消息查询不可用" when no store provided', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/recall');
      expect(result).toBe('消息查询不可用');
    });

    it('returns "消息查询不可用" with /rc alias', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/rc');
      expect(result).toBe('消息查询不可用');
    });

    it('returns recent messages when store is provided', async () => {
      const getRecentMessages = vi.fn().mockReturnValue([
        { text: '你好，请问今天的预约情况', source: 'user', timestamp: 1717000000000 },
        { text: '今天有3个预约待确认', source: 'bot', timestamp: 1717000060000 },
        { text: '好的，帮我看看下午2点的', source: 'user', timestamp: 1717000120000 },
      ]);
      const { handler } = createTestFixture(getRecentMessages);
      const result = await handler('hospital-crm-bot', 'chat1', '/recall');
      expect(result).toContain('最近 3 条消息');
      expect(result).toContain('预约情况');
      expect(result).toContain('待确认');
    });

    it('supports custom count argument', async () => {
      const getRecentMessages = vi.fn().mockReturnValue(
        Array(5).fill(null).map(() => ({ text: 'msg', source: 'user', timestamp: 1717000000000 })),
      );
      const { handler } = createTestFixture(getRecentMessages);
      const result = await handler('hospital-crm-bot', 'chat1', '/recall 5');
      expect(result).toContain('最近 5 条消息');
    });

    it('returns "暂无消息记录" when no messages', async () => {
      const getRecentMessages = vi.fn().mockReturnValue([]);
      const { handler } = createTestFixture(getRecentMessages);
      const result = await handler('hospital-crm-bot', 'chat1', '/recall');
      expect(result).toBe('暂无消息记录');
    });
  });

  describe('/help', () => {
    it('returns help text with all commands listed', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/help');
      expect(result).toContain('/clear');
      expect(result).toContain('/list');
      expect(result).toContain('/status');
      expect(result).toContain('/recall');
      expect(result).toContain('/help');
      expect(result).toContain('可用命令');
    });
  });

  describe('unknown command', () => {
    it('returns error message for unrecognized slash command', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/foo');
      expect(result).toBe('未知命令。输入 /help 查看可用命令。');
    });

    it('handles mixed-case commands (case insensitive)', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/HELP');
      expect(result).toContain('/help');
    });

    it('handles slash-only input as command (unknown)', async () => {
      const { handler } = createTestFixture();
      const result = await handler('hospital-crm-bot', 'chat1', '/');
      expect(result).toBe('未知命令。输入 /help 查看可用命令。');
    });
  });
});
