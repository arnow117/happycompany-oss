import { useState } from 'react';
import type { Employee } from '../../lib/api';

interface AgentCardProps {
  agent: Employee;
  selected: boolean;
  onSelect: (id: string) => void;
  onFork: (agentId: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  sales: '销售',
  maintenance: '维修',
  admin: '管理',
  readonly: '只读',
};

const SOURCE_COLORS: Record<string, React.CSSProperties> = {
  generated: {
    background: 'var(--color-success-dim)',
    color: 'var(--color-success)',
    borderColor: 'var(--color-success)',
  },
  prepopulated: {
    background: 'var(--color-accent-dim)',
    color: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
  },
  forked: {
    background: 'rgba(204, 120, 92, 0.08)',
    color: 'var(--color-accent-teal)',
    borderColor: 'var(--color-accent-teal)',
  },
};

const SOURCE_LABELS: Record<string, string> = {
  generated: '自动生成',
  prepopulated: '预装',
  forked: '分叉',
};

export function AgentCard({ agent, selected, onSelect, onFork }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [forking, setForking] = useState(false);

  const roleLabel = ROLE_LABELS[agent.role] || agent.role;
  const sourceLabel = SOURCE_LABELS[agent.source] || agent.source;
  const sourceStyle = SOURCE_COLORS[agent.source] || SOURCE_COLORS.generated;

  const handleToggleExpand = () => setExpanded((prev) => !prev);

  const handleCheckboxChange = () => onSelect(agent.id);

  const handleFork = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setForking(true);
    try {
      onFork(agent.id);
    } finally {
      setForking(false);
    }
  };

  return (
    <div
      style={{ ...s.card, ...(selected ? s.cardSelected : {}) }}
      onClick={handleToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggleExpand();
        }
      }}
      aria-expanded={expanded}
    >
      <div style={s.header}>
        <input
          type="checkbox"
          checked={selected}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          style={s.checkbox}
          aria-label={'选择 ' + agent.displayName}
        />
        <span style={s.displayName}>{agent.displayName}</span>
        <span style={s.roleBadge}>{roleLabel}</span>
        <span style={{ ...s.sourceBadge, ...sourceStyle }}>{sourceLabel}</span>
      </div>

      <div style={s.metaRow}>
        <span style={s.metaItem}>
          <span style={s.metaValue}>{agent.toolCount}</span>
          <span style={s.metaLabel}>Tools</span>
        </span>
        <span style={s.metaItem}>
          <span style={s.metaValue}>{agent.skillCount}</span>
          <span style={s.metaLabel}>Skills</span>
        </span>
      </div>

      {expanded && (
        <div style={s.expandedSection}>
          <div style={s.detailBlock}>
            <span style={s.detailBlockLabel}>System Prompt</span>
            <pre style={s.promptPreview}>
              {agent.systemPrompt}
            </pre>
          </div>

          {agent.tools.length > 0 && (
            <div style={s.detailBlock}>
              <span style={s.detailBlockLabel}>Tools</span>
              <div style={s.tagList}>
                {agent.tools.map((tool) => (
                  <span key={tool} style={{ ...s.tagItem, ...s.toolTag }}>{tool}</span>
                ))}
              </div>
            </div>
          )}

          {agent.skills.length > 0 && (
            <div style={s.detailBlock}>
              <span style={s.detailBlockLabel}>Skills</span>
              <div style={s.tagList}>
                {agent.skills.map((skill) => (
                  <span key={skill} style={{ ...s.tagItem, ...s.skillTag }}>{skill}</span>
                ))}
              </div>
            </div>
          )}

          <div style={s.forkRow}>
            <button onClick={handleFork} disabled={forking} style={s.forkButton}>
              {forking ? '分叉中…' : '分叉复制'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  card: {
    background: 'var(--color-bg-base)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-sm) var(--space-md)',
    cursor: 'pointer',
    transition: 'background var(--transition-fast), border-color var(--transition-fast)',
  } as React.CSSProperties,
  cardSelected: { borderColor: 'var(--color-accent)', background: 'var(--color-accent-dim)' } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)',
  } as React.CSSProperties,
  checkbox: {
    flexShrink: 0, width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--color-accent)',
  } as React.CSSProperties,
  displayName: {
    fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  roleBadge: {
    fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-accent)',
    background: 'var(--color-accent-dim)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  sourceBadge: {
    fontSize: 'var(--text-xs)', fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-pill)',
    border: '1px solid', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  metaRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)' } as React.CSSProperties,
  metaItem: { display: 'flex', alignItems: 'center', gap: '4px' } as React.CSSProperties,
  metaValue: {
    fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  metaLabel: {
    fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 400,
  } as React.CSSProperties,
  expandedSection: {
    marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)',
    borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
  } as React.CSSProperties,
  detailBlock: { display: 'flex', flexDirection: 'column', gap: '4px' } as React.CSSProperties,
  detailBlockLabel: {
    fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)',
    textTransform: 'uppercase', letterSpacing: '1px',
  } as React.CSSProperties,
  promptPreview: {
    margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
    lineHeight: 1.5, fontFamily: 'var(--font-mono)', wordBreak: 'break-word',
    whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto',
  } as React.CSSProperties,
  tagList: { display: 'flex', flexWrap: 'wrap', gap: '6px' } as React.CSSProperties,
  tagItem: {
    fontSize: 'var(--text-xs)', fontWeight: 400, padding: '2px 8px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  toolTag: { background: 'rgba(93, 184, 166, 0.15)', color: 'var(--color-accent-teal)' } as React.CSSProperties,
  skillTag: { background: 'rgba(232, 165, 90, 0.15)', color: 'var(--color-accent-amber)' } as React.CSSProperties,
  forkRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-xs)' } as React.CSSProperties,
  forkButton: {
    fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-accent-active)',
    background: 'var(--color-accent-dim)', border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-md)', padding: '4px 14px', cursor: 'pointer',
    transition: 'background var(--transition-fast)', fontFamily: 'var(--font-body)',
  } as React.CSSProperties,
};
