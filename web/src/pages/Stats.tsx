import { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';
import type { ChatSummary, SkillStats } from '../lib/api';
import { ChatTable } from './stats/ChatTable';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

export function Stats() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [skillStats, setSkillStats] = useState<SkillStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [botFilter, setBotFilter] = useState<string>('');

  useEffect(() => {
    Promise.all([
      api.listChats(),
      api.getSkillStats().catch(() => []),
    ])
      .then(([chatsList, skills]) => {
        setChats(chatsList);
        setSkillStats(skills);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load stats'),
      )
      .finally(() => setLoading(false));
  }, []);

  const botNames = useMemo(() => {
    const names = new Set(chats.map((c) => c.botName).filter(Boolean));
    return Array.from(names).sort();
  }, [chats]);

  const filteredChats = useMemo(() => {
    if (!botFilter) return chats;
    return chats.filter((c) => c.botName === botFilter);
  }, [chats, botFilter]);

  const totalMessages = filteredChats.reduce((sum, c) => sum + c.messageCount, 0);

  if (loading) {
    return (
      <div className="loading-state">
        <LoadingSkeleton type="card" count={3} />
        <div style={{ marginTop: 24 }}>
          <LoadingSkeleton type="table-row" count={5} />
        </div>
      </div>
    );
  }

  return (
    <section>
      <h2 style={heading}>Stats</h2>
      <p style={subtitle}>Message statistics — click a chat row to view messages.</p>

      {error && (
        <div style={errorBanner}>{error}</div>
      )}

      {botNames.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: 'var(--space-lg)' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Bot</span>
          <select
            value={botFilter}
            onChange={(e) => setBotFilter(e.target.value)}
            style={{
              padding: '6px 12px', fontSize: '14px', fontFamily: 'var(--font-body)',
              color: 'var(--color-text-primary)', background: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            <option value="">All Bots</option>
            {botNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={summaryBar}>
        <div style={summaryItem}>
          <span style={summaryValue}>{filteredChats.length}</span>
          <span style={summaryLabel}>Chats</span>
        </div>
        <div style={summaryDivider} />
        <div style={summaryItem}>
          <span style={summaryValue}>{totalMessages}</span>
          <span style={summaryLabel}>Messages</span>
        </div>
        <div style={summaryDivider} />
        <div style={summaryItem}>
          <span style={summaryValue}>
            {filteredChats.length > 0 ? Math.round(totalMessages / filteredChats.length) : 0}
          </span>
          <span style={summaryLabel}>Avg / Chat</span>
        </div>
      </div>

      <h3 style={sectionTitle}>Skill Usage</h3>
      {skillStats.length === 0 ? (
        <p style={emptyNote}>No skill calls recorded yet.</p>
      ) : (
        <div style={skillTable}>
          <div style={skillHeader}>
            <span style={skillColName}>Skill</span>
            <span style={skillColNum}>Calls</span>
            <span style={skillColNum}>Success</span>
            <span style={skillColNum}>Avg Time</span>
          </div>
          {skillStats.map((s) => (
            <div key={s.skillName} style={skillRow}>
              <span style={{ ...skillColName, fontWeight: 500 }}>{s.skillName}</span>
              <span style={skillColNum}>{s.callCount}</span>
              <span style={{ ...skillColNum, color: s.failureCount > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                {s.callCount > 0 ? Math.round((s.successCount / s.callCount) * 100) : 0}%
              </span>
              <span style={skillColNum}>{s.avgDurationMs}ms</span>
            </div>
          ))}
        </div>
      )}

      <h3 style={sectionTitle}>Messages per Chat</h3>
      <ChatTable chats={chats} />
    </section>
  );
}

const heading: React.CSSProperties = {
  fontSize: '36px', fontWeight: 400, fontFamily: 'var(--font-display)',
  letterSpacing: '-0.5px', margin: 0, color: 'var(--color-text-primary)',
};

const subtitle: React.CSSProperties = {
  fontSize: '16px', color: 'var(--color-text-muted)', margin: '8px 0 0',
};

const errorBanner: React.CSSProperties = {
  marginTop: 'var(--space-md)', padding: '12px 20px',
  background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: '14px',
};

const summaryBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', marginTop: 'var(--space-lg)',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)', padding: '24px 32px',
};

const summaryItem: React.CSSProperties = { flex: 1, textAlign: 'center' };

const summaryValue: React.CSSProperties = {
  display: 'block', fontSize: '36px', fontWeight: 400,
  fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', color: 'var(--color-text-primary)',
};

const summaryLabel: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 500,
  textTransform: 'uppercase', letterSpacing: '1.5px',
  color: 'var(--color-text-muted)', marginTop: '4px',
};

const summaryDivider: React.CSSProperties = {
  width: '1px', height: '40px', background: 'var(--color-border)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '16px', fontWeight: 500, margin: 'var(--space-lg) 0 var(--space-sm)',
  color: 'var(--color-text-secondary)',
};

const emptyNote: React.CSSProperties = {
  color: 'var(--color-text-muted)', fontSize: '14px', padding: '16px 0',
};

const skillTable: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

const skillHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '10px 16px',
  background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)',
  fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px',
  color: 'var(--color-text-muted)',
};

const skillRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '10px 16px',
  borderBottom: '1px solid var(--color-border)', fontSize: '14px',
};

const skillColName: React.CSSProperties = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' };

const skillColNum: React.CSSProperties = {
  width: '80px', textAlign: 'right', flexShrink: 0,
  fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-text-secondary)',
};

