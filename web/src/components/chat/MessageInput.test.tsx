import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { MessageInput } from './MessageInput';

describe('MessageInput', () => {
  test('pressing Enter sends a slash command instead of only completing it', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);

    render(<MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('输入消息... (Enter 发送)');
    await user.type(input, '/status');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('/status', undefined);
    });
  });

  test('restores draft text when switching conversation keys', () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <MessageInput onSend={onSend} draftKey="chat-1" draftText="继续写第一段" />,
    );

    expect(screen.getByPlaceholderText('输入消息... (Enter 发送)')).toHaveValue('继续写第一段');

    rerender(<MessageInput onSend={onSend} draftKey="chat-2" draftText="新的会话草稿" />);

    expect(screen.getByPlaceholderText('输入消息... (Enter 发送)')).toHaveValue('新的会话草稿');
  });

  test('shows disabled status and does not submit while disconnected', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);

    render(
      <MessageInput
        onSend={onSend}
        disabled
        statusText="连接中断，消息暂不能发送"
        placeholder="正在等待服务器连接..."
      />,
    );

    expect(screen.getByText('连接中断，消息暂不能发送')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('正在等待服务器连接...'), 'hello');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  test('labels the send button when input is empty', () => {
    const onSend = vi.fn().mockResolvedValue(true);

    render(<MessageInput onSend={onSend} />);

    expect(screen.getByRole('button', { name: '请输入消息后发送' })).toBeDisabled();
  });
});
