export interface BotInfo {
  name: string;
  displayName: string;
  channel: string;
  sessionCount: number;
}

const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export function formatBotList(bots: BotInfo[], currentBot?: string): string {
  const lines = bots.map((bot) => {
    const marker = bot.name === currentBot ? '> ' : '  ';
    return `${marker}${bot.name} (${channelLabel(bot.channel)}) - ${bot.sessionCount} sessions`;
  });

  return lines.join('\n');
}

export function formatBotStatus(bot: BotInfo): string {
  return [
    `Bot: ${bot.name}`,
    `Display: ${bot.displayName}`,
    `Channel: ${bot.channel}`,
    `Sessions: ${bot.sessionCount}`,
  ].join('\n');
}

export function formatHelpText(): string {
  return [
    '可用命令：',
    '/clear - 清除当前会话',
    '/list, /ls - 列出所有 Bot',
    '/status - 当前 Bot 状态',
    '/recall, /rc - 总结最近消息',
    '/help - 显示帮助',
  ].join('\n');
}
