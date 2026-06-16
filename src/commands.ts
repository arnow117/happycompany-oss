import type { BotInfo } from './command-utils.js';
import { formatBotList, formatBotStatus, formatHelpText } from './command-utils.js';

export type CommandHandler = (
  botName: string,
  chatId: string,
  args: string,
) => Promise<string | null>;

export function createCommandHandler(
  getBots: () => BotInfo[],
  clearSession: (botName: string, chatId: string) => boolean,
  getRecentMessages?: (chatId: string, limit: number) => Array<{ text: string; source: string; timestamp: number }>,
): CommandHandler {
  return async (botName: string, chatId: string, args: string): Promise<string | null> => {
    const trimmed = args.trim();

    if (!trimmed || !trimmed.startsWith('/')) {
      return null;
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0];
    const commandName = command.slice(1).toLowerCase();
    const countArg = parseInt(parts[1] ?? '10', 10) || 10;

    switch (commandName) {
      case 'clear': {
        clearSession(botName, chatId);
        return '会话已清除';
      }

      case 'list':
      case 'ls': {
        const bots = getBots();
        return formatBotList(bots, botName);
      }

      case 'status': {
        const bots = getBots();
        const current = bots.find((b) => b.name === botName);
        if (!current) {
          return '未找到当前 Bot 信息';
        }
        return formatBotStatus(current);
      }

      case 'recall':
      case 'rc': {
        if (!getRecentMessages) {
          return '消息查询不可用';
        }
        const messages = getRecentMessages(chatId, countArg);
        if (messages.length === 0) {
          return '暂无消息记录';
        }
        const lines = messages
          .slice()
          .reverse()
          .map((m) => {
            const time = new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const role = m.source === 'user' ? '你' : 'Bot';
            const preview = m.text.length > 100 ? m.text.slice(0, 100) + '...' : m.text;
            return `[${time}] ${role}: ${preview}`;
          });
        return `最近 ${messages.length} 条消息：\n${lines.join('\n')}`;
      }

      case 'help':
        return formatHelpText();

      default:
        return '未知命令。输入 /help 查看可用命令。';
    }
  };
}
