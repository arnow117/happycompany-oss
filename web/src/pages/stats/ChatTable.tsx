import { Link } from 'react-router-dom';
import type { ChatSummary } from '../../lib/api';

interface ChatTableProps {
  chats: ChatSummary[];
}

export function ChatTable({ chats }: ChatTableProps) {
  const maxCount = Math.max(...chats.map((c) => c.messageCount), 1);

  return (
    <div style={wrapper}>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Bot</th>
            <th style={th}>Chat ID</th>
            <th style={th}>Messages</th>
            <th style={th}>Last Activity</th>
            <th style={{ ...th, width: '60px' }}></th>
          </tr>
        </thead>
        <tbody>
          {chats.length === 0 ? (
            <tr>
              <td colSpan={5} style={emptyCell}>No chats recorded.</td>
            </tr>
          ) : (
            [...chats]
              .sort((a, b) => b.messageCount - a.messageCount)
              .map((chat) => (
                <tr key={chat.chatId} style={rowStyle}>
                  <td style={td}>
                    <span style={botName}>{chat.botName || '-'}</span>
                  </td>
                  <td style={td}>
                    <span style={chatId}>{chat.chatId.slice(-20)}</span>
                  </td>
                  <td style={td}>
                    <div style={barContainer}>
                      <div style={{
                        ...barFill,
                        width: `${Math.min(100, (chat.messageCount / maxCount) * 100)}%`,
                      }} />
                      <span style={barLabel}>{chat.messageCount}</span>
                    </div>
                  </td>
                  <td style={td}>
                    <span style={dateValue}>
                      {chat.lastMessageAt > 0
                        ? new Date(chat.lastMessageAt).toLocaleDateString()
                        : '--'}
                    </span>
                  </td>
                  <td style={td}>
                    {chat.botName && (
                      <Link
                        to={`/sessions`}
                        style={viewLink}
                        title="View messages in Sessions"
                      >
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const wrapper: React.CSSProperties = {
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)', overflow: 'auto',
};

const table: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '14px',
};

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', fontWeight: 500,
  fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1.5px',
  color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)',
};

const rowStyle: React.CSSProperties = {
  transition: 'background var(--transition-fast)',
};

const td: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid var(--color-border-soft)',
  color: 'var(--color-text-primary)',
};

const emptyCell: React.CSSProperties = {
  ...td, textAlign: 'center', color: 'var(--color-text-muted)', padding: '32px 16px',
};

const chatId: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '13px',
};

const barContainer: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', minWidth: '120px',
};

const barFill: React.CSSProperties = {
  height: '6px', background: 'var(--color-accent)', borderRadius: '3px',
  minWidth: '4px', transition: 'width var(--transition-normal)',
};

const barLabel: React.CSSProperties = {
  fontSize: '14px', fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-primary)', fontWeight: 500, minWidth: '36px',
};

const dateValue: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-muted)',
};

const botName: React.CSSProperties = {
  fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)',
};

const viewLink: React.CSSProperties = {
  padding: '2px 8px', fontSize: '11px', fontWeight: 500,
  color: 'var(--color-accent)', background: 'var(--color-accent-dim)',
  border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-pill)',
  textDecoration: 'none', fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
};
