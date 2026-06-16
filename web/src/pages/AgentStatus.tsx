import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { BusinessAgent, BusinessChannel } from '../lib/api';

export function AgentStatus() {
  const [agents, setAgents] = useState<BusinessAgent[]>([]);
  const [channels, setChannels] = useState<BusinessChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [clearingAgent, setClearingAgent] = useState<string | null>(null);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.listBusinessAgents(),
      api.listBusinessChannels(),
    ])
      .then(([agentRes, channelRes]) => {
        setAgents(agentRes.agents);
        setChannels(channelRes.channels);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load agent status'),
      )
      .finally(() => setLoading(false));
  }, []);

  const handleClearSessions = (agentName: string) => {
    setClearingAgent(agentName);
    api.clearBusinessAgentSessions(agentName)
      .then((res) => {
        setClearedCount(res.cleared);
        setSelectedAgent(null);
        // Refresh agent list to update session counts
        return api.listBusinessAgents();
      })
      .then((res) => setAgents(res.agents))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to clear sessions'),
      )
      .finally(() => {
        setClearingAgent(null);
        setTimeout(() => setClearedCount(null), 3000);
      });
  };

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const totalSessions = agents.reduce((sum, a) => sum + a.sessionCount, 0);

  if (loading) {
    return <div style={loadingState}>Loading agent status...</div>;
  }

  return (
    <section>
      <h2 style={heading}>Agent Status</h2>
      <p style={subtitle}>Monitor connected agents, channels, and session activity.</p>

      {error && <div style={errorBanner}>{error}</div>}

      {clearedCount !== null && (
        <div style={feedbackBanner}>
          Cleared {clearedCount} session{clearedCount !== 1 ? 's' : ''}.
        </div>
      )}

      <div style={statsRow}>
        <div style={statCard}>
          <span style={statValue}>{agents.length}</span>
          <span style={statLabel}>Agents</span>
        </div>
        <div style={statCard}>
          <span style={{ ...statValue, color: 'var(--color-success)' }}>{runningCount}</span>
          <span style={statLabel}>Running</span>
        </div>
        <div style={statCard}>
          <span style={statValue}>{channels.length}</span>
          <span style={statLabel}>Channels</span>
        </div>
        <div style={statCard}>
          <span style={statValue}>{totalSessions}</span>
          <span style={statLabel}>Sessions</span>
        </div>
      </div>

      {agents.length === 0 ? (
        <div style={emptyState}>No agents configured.</div>
      ) : (
        <div style={grid}>
          {agents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              isSelected={selectedAgent === agent.name}
              isClearing={clearingAgent === agent.name}
              onSelect={() =>
                setSelectedAgent(selectedAgent === agent.name ? null : agent.name)
              }
              onClearSessions={() => handleClearSessions(agent.name)}
            />
          ))}
        </div>
      )}

      {channels.length > 0 && (
        <section style={{ marginTop: 'var(--space-xl)' }}>
          <h3 style={sectionHeading}>Channels</h3>
          <div style={channelGrid}>
            {channels.map((ch) => (
              <div key={ch.name} style={channelCard}>
                <div style={channelName}>{ch.name}</div>
                <div style={channelBotCount}>{ch.botCount} bot{ch.botCount !== 1 ? 's' : ''}</div>
                <div style={channelBotList}>
                  {ch.bots.map((b) => (
                    <div key={b.name} style={channelBotItem}>
                      <span
                        style={{
                          ...statusDot,
                          background: b.status === 'running' ? 'var(--color-success)' : 'var(--color-text-muted-soft)',
                        }}
                      />
                      <span>{b.displayName || b.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

interface AgentCardProps {
  agent: BusinessAgent;
  isSelected: boolean;
  isClearing: boolean;
  onSelect: () => void;
  onClearSessions: () => void;
}

function AgentCard({ agent, isSelected, isClearing, onSelect, onClearSessions }: AgentCardProps) {
  const isRunning = agent.status === 'running';

  return (
    <div
      style={{
        ...card,
        borderColor: isSelected ? 'var(--color-accent)' : undefined,
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
    >
      <div style={cardHeader}>
        <div style={cardTitleRow}>
          <span
            style={{
              ...statusDot,
              background: isRunning ? 'var(--color-success)' : 'var(--color-text-muted-soft)',
            }}
          />
          <span style={cardName}>{agent.displayName || agent.name}</span>
        </div>
        <span
          style={{
            ...statusBadge,
            color: isRunning ? 'var(--color-success)' : 'var(--color-text-muted)',
            borderColor: isRunning ? 'var(--color-success)' : 'var(--color-border)',
          }}
        >
          {agent.status}
        </span>
      </div>

      <div style={cardMeta}>
        <span style={metaItem}>{agent.channel}</span>
        <span style={metaDivider}>/</span>
        <span style={metaItem}>{agent.model}</span>
      </div>

      <div style={cardFooter}>
        <span style={sessionCount}>
          {agent.sessionCount} session{agent.sessionCount !== 1 ? 's' : ''}
        </span>
        <button
          style={{
            ...clearBtn,
            opacity: isClearing ? 0.5 : 1,
          }}
          disabled={isClearing}
          onClick={(e) => {
            e.stopPropagation();
            onClearSessions();
          }}
        >
          {isClearing ? 'Clearing...' : 'Clear Sessions'}
        </button>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────

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

const feedbackBanner: React.CSSProperties = {
  marginTop: 'var(--space-md)', padding: '12px 20px',
  background: 'var(--color-success-dim)', border: '1px solid var(--color-success)',
  borderRadius: 'var(--radius-md)', color: 'var(--color-success)', fontSize: '14px',
};

const loadingState: React.CSSProperties = {
  padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)',
};

const emptyState: React.CSSProperties = {
  marginTop: 'var(--space-xl)', padding: '32px', textAlign: 'center',
  color: 'var(--color-text-muted)', fontSize: '14px',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const statsRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 'var(--space-md)', marginTop: 'var(--space-lg)',
};

const statCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
  padding: '20px 16px', background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
};

const statValue: React.CSSProperties = {
  fontSize: '28px', fontWeight: 400, fontFamily: 'var(--font-display)',
  color: 'var(--color-text-primary)', lineHeight: 1,
};

const statLabel: React.CSSProperties = {
  fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)',
  textTransform: 'uppercase', letterSpacing: '1.5px',
};

const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 'var(--space-md)', marginTop: 'var(--space-lg)',
};

const card: React.CSSProperties = {
  padding: '20px', background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
  cursor: 'pointer', transition: 'border-color 150ms, transform 150ms',
};

const cardHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: '12px',
};

const cardTitleRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
};

const statusDot: React.CSSProperties = {
  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
};

const cardName: React.CSSProperties = {
  fontSize: '16px', fontWeight: 500, color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-display)',
};

const statusBadge: React.CSSProperties = {
  fontSize: '11px', fontWeight: 500, textTransform: 'uppercase',
  letterSpacing: '1px', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
  border: '1px solid',
};

const cardMeta: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '16px',
};

const metaItem: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '12px',
};

const metaDivider: React.CSSProperties = {
  color: 'var(--color-text-muted-soft)',
};

const cardFooter: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  paddingTop: '12px', borderTop: '1px solid var(--color-border)',
};

const sessionCount: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-secondary)',
};

const clearBtn: React.CSSProperties = {
  padding: '4px 12px', fontSize: '11px', fontWeight: 500,
  color: 'var(--color-danger)', background: 'var(--color-danger-dim)',
  border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-pill)',
  cursor: 'pointer', fontFamily: 'var(--font-body)',
  textTransform: 'uppercase', letterSpacing: '1px',
};

const sectionHeading: React.CSSProperties = {
  fontSize: '20px', fontWeight: 400, fontFamily: 'var(--font-display)',
  color: 'var(--color-text-primary)', margin: '0 0 var(--space-md)',
};

const channelGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 'var(--space-md)',
};

const channelCard: React.CSSProperties = {
  padding: '16px', background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
};

const channelName: React.CSSProperties = {
  fontSize: '16px', fontWeight: 500, fontFamily: 'var(--font-display)',
  color: 'var(--color-text-primary)', marginBottom: '4px',
};

const channelBotCount: React.CSSProperties = {
  fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '12px',
};

const channelBotList: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '6px',
};

const channelBotItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  fontSize: '13px', color: 'var(--color-text-secondary)',
};
