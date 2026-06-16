import type { StatsSummary } from '../../lib/api';

interface GraphStatsProps {
  stats: StatsSummary;
}

export function GraphStats({ stats }: GraphStatsProps) {
  const roleEntries = Object.entries(stats.agentsByRole);

  return (
    <div style={s.container}>
      <div style={s.row}>
        <div style={s.statCard}>
          <span style={s.statValue}>{stats.totalAgents}</span>
          <span style={s.statLabel}>数字员工总数</span>
        </div>
        <div style={s.statCard}>
          <span style={s.statValue}>{stats.totalSkills}</span>
          <span style={s.statLabel}>技能总数</span>
        </div>
        <div style={s.statCard}>
          <span
            style={{
              ...s.statValue,
              color: stats.totalFallbacks > 0
                ? 'var(--color-warning)'
                : 'var(--color-text-primary)',
            }}
          >
            {stats.totalFallbacks}
          </span>
          <span style={s.statLabel}>人工回退</span>
        </div>
      </div>

      {roleEntries.length > 0 && (
        <div style={s.roleSection}>
          <span style={s.roleSectionTitle}>角色分布</span>
          <div style={s.roleGrid}>
            {roleEntries.map(([role, count]) => (
              <div key={role} style={s.roleItem}>
                <span style={s.roleBadge}>{role}</span>
                <span style={s.roleCount}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  container: {
    display: 'flex', flexDirection: 'column', gap: 'var(--space-md)',
    padding: 'var(--space-md)', background: 'transparent',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
  } as React.CSSProperties,
  row: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' } as React.CSSProperties,
  statCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
    flex: 1, minWidth: '100px', padding: 'var(--space-md)',
    background: 'var(--color-bg-raised)', borderRadius: 'var(--radius-md)',
  } as React.CSSProperties,
  statValue: {
    fontSize: '28px', fontWeight: 600, color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)', lineHeight: 1.1,
  } as React.CSSProperties,
  statLabel: {
    fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)',
    textTransform: 'uppercase', letterSpacing: '1.5px',
  } as React.CSSProperties,
  roleSection: {
    display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)',
    paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border)',
  } as React.CSSProperties,
  roleSectionTitle: {
    fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)',
    textTransform: 'uppercase', letterSpacing: '1.5px',
  } as React.CSSProperties,
  roleGrid: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' } as React.CSSProperties,
  roleItem: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
    background: 'var(--color-bg-raised)', borderRadius: 'var(--radius-sm)',
  } as React.CSSProperties,
  roleBadge: {
    fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  roleCount: {
    fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
};
