import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatTable } from './ChatTable';
import type { ChatSummary } from '../../lib/api';

describe('ChatTable', () => {
  it('shows "No chats recorded." when empty', () => {
    render(<ChatTable chats={[]} />);
    expect(screen.getByText('No chats recorded.')).toBeInTheDocument();
  });

  it('sorts chats by messageCount descending', () => {
    const chats: ChatSummary[] = [
      { chatId: 'chat-a', messageCount: 5, lastMessageAt: 1000 },
      { chatId: 'chat-b', messageCount: 20, lastMessageAt: 2000 },
      { chatId: 'chat-c', messageCount: 10, lastMessageAt: 3000 },
    ];
    render(<ChatTable chats={chats} />);

    const rows = screen.getAllByRole('row').slice(1); // skip header
    expect(rows[0]).toHaveTextContent('chat-b');  // 20
    expect(rows[1]).toHaveTextContent('chat-c');  // 10
    expect(rows[2]).toHaveTextContent('chat-a');  // 5
  });

  it('bar width proportional to max count', () => {
    const chats: ChatSummary[] = [
      { chatId: 'chat-a', messageCount: 50, lastMessageAt: 1000 },
      { chatId: 'chat-b', messageCount: 25, lastMessageAt: 2000 },
    ];
    const { container } = render(<ChatTable chats={chats} />);

    const bars = container.querySelectorAll('div[style]');
    // Find bar fill divs by checking width style
    const barFills = Array.from(bars).filter(
      (el) => (el as HTMLElement).style.width && (el as HTMLElement).style.height === '6px',
    );
    expect(barFills).toHaveLength(2);
    // Max count (50) gets 100%, half count (25) gets 50%
    expect((barFills[0] as HTMLElement).style.width).toBe('100%');
    expect((barFills[1] as HTMLElement).style.width).toBe('50%');
  });

  it('shows "--" when lastMessageAt is 0', () => {
    const chats: ChatSummary[] = [
      { chatId: 'chat-x', messageCount: 3, lastMessageAt: 0 },
    ];
    render(<ChatTable chats={chats} />);
    const row = screen.getByText('chat-x').closest('tr')!;
    expect(row).toHaveTextContent('--');
  });

  it('shows date when lastMessageAt > 0', () => {
    const timestamp = new Date('2026-04-15T12:00:00Z').getTime();
    const chats: ChatSummary[] = [
      { chatId: 'chat-y', messageCount: 7, lastMessageAt: timestamp },
    ];
    render(<ChatTable chats={chats} />);
    const row = screen.getByText('chat-y').closest('tr')!;
    // Should contain a formatted date, not "--"
    expect(row).not.toHaveTextContent('--');
    expect(row.textContent).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });
});
