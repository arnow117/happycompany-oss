import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore, type StreamingState } from '../../stores/chat';
import { StreamingDisplay } from './StreamingDisplay';

function streamingWith(overrides: Partial<StreamingState>): StreamingState {
  return {
    isStreaming: true,
    partialText: '',
    thinkingText: '',
    isThinking: false,
    thinkingDurationMs: 0,
    activeTools: [],
    systemStatus: undefined,
    recentEvents: [],
    collaborations: [],
    todos: [],
    interrupted: false,
    ...overrides,
  };
}

describe('StreamingDisplay', () => {
  beforeEach(() => {
    useChatStore.setState({ streaming: {} });
  });

  it('renders completed handoff results in the collaboration card', () => {
    useChatStore.setState({
      streaming: {
        'sales-zhangsan:chat-1': streamingWith({
          collaborations: [{
            from: 'sales-zhangsan',
            to: 'maintenance-lisi',
            reason: '确认维保记录',
            status: 'completed',
            result: '维修李四确认：设备维保记录已核验。',
            timestamp: 123,
            completedAt: 456,
          }],
        }),
      },
    });

    render(<StreamingDisplay streamingKey="sales-zhangsan:chat-1" isWaiting={false} senderName="销售张三" />);

    expect(screen.getByText('协同处理中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('协同结果')).toBeInTheDocument();
    expect(screen.getByText('维修李四确认：设备维保记录已核验。')).toBeInTheDocument();
  });
});
