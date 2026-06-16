import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../../stores/chat';

describe('MessageBubble observability panel', () => {
  it('renders an expandable agent run board for bot messages', () => {
    const message: ChatMessage = {
      id: 'bot-1',
      chatId: 'chat-1',
      text: '处理完成',
      source: 'bot',
      botName: 'sales-zhangsan',
      timestamp: 1_717_000_000_000,
      observability: {
        summary: { status: 'completed', stopReason: 'end_turn', errors: [], permissionDenials: [] },
        init: {
          sessionId: 'sdk-session-1',
          model: 'claude-test',
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
        toolCalls: [{
          toolName: 'Read',
          toolUseId: 'tool-1',
          elapsedMs: 42,
          input: { file: 'README.md' },
          status: 'completed',
        }],
        handoffs: [{
          from: 'sales-zhangsan',
          to: 'maintenance-lisi',
          reason: '查询维保',
          status: 'completed',
          result: '维保有效',
        }],
        startedAt: 1_717_000_000_000,
        finishedAt: 1_717_000_001_500,
      },
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText('运行看板')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('claude-test')).toBeInTheDocument();

    fireEvent.click(screen.getByText('运行看板'));

    expect(screen.getByText('输入 tokens')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('协同交接')).toBeInTheDocument();
    expect(screen.getByText('maintenance-lisi')).toBeInTheDocument();
    expect(screen.getByText('维保有效')).toBeInTheDocument();
  });
});
