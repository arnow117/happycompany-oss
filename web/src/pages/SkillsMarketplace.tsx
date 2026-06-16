import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { SkillInfo } from '../lib/api';
import { UsedByBots } from '../components/skill-marketplace/UsedByBots';
import { useChatStore } from '../stores/chat';

type SkillScope = 'all' | 'tenant' | 'global';

function skillScope(skill: SkillInfo): Exclude<SkillScope, 'all'> {
  return skill.source.startsWith('tenant:') ? 'tenant' : 'global';
}

function sourceLabel(skill: SkillInfo): string {
  if (skill.source.startsWith('tenant:')) return `企业 · ${skill.source.slice('tenant:'.length)}`;
  if (skill.source === 'local') return '全局 · 平台';
  return '全局';
}

function sourceRank(skill: SkillInfo): number {
  return skillScope(skill) === 'tenant' ? 0 : 1;
}

export function SkillsMarketplace() {
  const [searchParams] = useSearchParams();
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const tenants = useChatStore((state) => state.tenants);
  const tenant = selectedTenant || tenants[0]?.id;
  const focusedSkill = searchParams.get('skill') || searchParams.get('app') || '';

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<SkillScope>('all');

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.listSkills(tenant)
      .then(setSkills)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load skills'),
      )
      .finally(() => setLoading(false));
  }, [tenant]);

  useEffect(() => {
    if (!focusedSkill) return;
    setScope('all');
  }, [focusedSkill]);

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) =>
      sourceRank(a) - sourceRank(b) ||
      a.name.localeCompare(b.name),
    ),
    [skills],
  );

  const visibleSkills = useMemo(
    () => sortedSkills.filter((skill) => {
      const matchesScope = scope === 'all' || skillScope(skill) === scope;
      const matchesFocus = !focusedSkill || skill.id === focusedSkill || skill.name === focusedSkill;
      return matchesScope && matchesFocus;
    }),
    [focusedSkill, scope, sortedSkills],
  );

  const counts = useMemo(() => ({
    all: skills.length,
    tenant: skills.filter((skill) => skillScope(skill) === 'tenant').length,
    global: skills.filter((skill) => skillScope(skill) === 'global').length,
  }), [skills]);

  return (
    <section>
      <div style={headerRow}>
        <div>
          <h2 style={heading}>技能市场</h2>
          <p style={subtitle}>浏览企业技能和全局技能。员工绑定请到数字员工页面管理。</p>
        </div>
      </div>

      <div style={summaryRow}>
        <Metric label="企业技能" value={counts.tenant} />
        <Metric label="全局技能" value={counts.global} />
        <Metric label="全部" value={counts.all} />
      </div>

      <div style={tabBar}>
        <button onClick={() => setScope('all')} style={scope === 'all' ? activeTabStyle : inactiveTabStyle}>
          全部
        </button>
        <button onClick={() => setScope('tenant')} style={scope === 'tenant' ? activeTabStyle : inactiveTabStyle}>
          企业技能
        </button>
        <button onClick={() => setScope('global')} style={scope === 'global' ? activeTabStyle : inactiveTabStyle}>
          全局技能
        </button>
      </div>

      {focusedSkill && (
        <div style={noticeBanner}>
          已从链接定位到「{focusedSkill}」。员工技能绑定请在数字员工页面调整。
        </div>
      )}

      {error && <div style={errorBanner}>{error}</div>}
      {loading && <div style={loadingState}>Scanning skills...</div>}

      {!loading && !error && visibleSkills.length === 0 && (
        <div style={emptyState}>
          {focusedSkill ? `没有找到技能「${focusedSkill}」。` : '当前范围没有技能。'}
        </div>
      )}

      {!loading && !error && visibleSkills.length > 0 && (
        <div style={grid}>
          {visibleSkills.map((skill) => (
            <SkillCard key={`${skill.source}/${skill.id}`} skill={skill} />
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={metric}>
      <span style={metricLabel}>{label}</span>
      <strong style={metricValue}>{value}</strong>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  return (
    <article style={card}>
      <div style={cardHeader}>
        <span style={skillName}>{skill.name}</span>
        <span
          style={{
            ...statusBadge,
            background: skillScope(skill) === 'tenant' ? 'var(--color-accent-dim)' : 'var(--color-success-dim)',
            color: skillScope(skill) === 'tenant' ? 'var(--color-accent)' : 'var(--color-success)',
          }}
        >
          {skillScope(skill) === 'tenant' ? '企业' : '全局'}
        </span>
      </div>
      <p style={skillDesc}>{skill.description || 'No description.'}</p>
      <div style={metaRow}>
        <span style={metaLabel}>Source</span>
        <span style={metaValue}>{sourceLabel(skill)}</span>
      </div>
      <div style={metaRow}>
        <span style={metaLabel}>Files</span>
        <span style={metaValue}>{skill.files.length}</span>
      </div>
      {skill.allowedTools.length > 0 && (
        <div style={metaRow}>
          <span style={metaLabel}>Tools</span>
          <span style={metaValue}>{skill.allowedTools.join(', ')}</span>
        </div>
      )}
      <div style={metaRow}>
        <span style={metaLabel}>Updated</span>
        <span style={metaValue}>{new Date(skill.updatedAt).toLocaleDateString()}</span>
      </div>
      <UsedByBots skillName={skill.id} />
    </article>
  );
}

const heading: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 400,
  fontFamily: 'var(--font-display)',
  letterSpacing: '-0.5px',
  margin: 0,
  color: 'var(--color-text-primary)',
};

const subtitle: React.CSSProperties = {
  fontSize: '16px',
  color: 'var(--color-text-muted)',
  margin: '8px 0 0',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 'var(--space-lg)',
  flexWrap: 'wrap',
};

const summaryRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 'var(--space-sm)',
  marginTop: 'var(--space-lg)',
  maxWidth: '560px',
};

const metric: React.CSSProperties = {
  padding: '14px 16px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const metricLabel: React.CSSProperties = {
  display: 'block',
  color: 'var(--color-text-muted)',
  fontSize: '12px',
  marginBottom: '6px',
};

const metricValue: React.CSSProperties = {
  color: 'var(--color-text-primary)',
  fontSize: '24px',
  fontWeight: 500,
};

const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  marginTop: 'var(--space-lg)',
  background: 'var(--color-bg-base)',
  borderRadius: 'var(--radius-lg)',
  padding: '4px',
  width: 'fit-content',
};

const activeTabStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-accent)',
  color: 'white',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const inactiveTabStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: '13px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  transition: 'color 150ms',
};

const noticeBanner: React.CSSProperties = {
  marginTop: 'var(--space-md)',
  padding: '12px 20px',
  background: 'var(--color-accent-dim)',
  border: '1px solid var(--color-accent)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-secondary)',
  fontSize: '14px',
  lineHeight: 1.6,
};

const errorBanner: React.CSSProperties = {
  marginTop: 'var(--space-md)',
  padding: '12px 20px',
  background: 'var(--color-danger-dim)',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-danger)',
  fontSize: '14px',
};

const loadingState: React.CSSProperties = {
  padding: '48px',
  textAlign: 'center',
  color: 'var(--color-text-muted)',
};

const emptyState: React.CSSProperties = {
  marginTop: 'var(--space-xl)',
  padding: '32px',
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  fontSize: '14px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 'var(--space-md)',
  marginTop: 'var(--space-md)',
};

const card: React.CSSProperties = {
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '24px',
  boxShadow: 'var(--shadow-card)',
};

const cardHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '10px',
};

const skillName: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
};

const statusBadge: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: '12px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '1.5px',
  borderRadius: 'var(--radius-pill)',
  flexShrink: 0,
};

const skillDesc: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--color-text-secondary)',
  margin: '0 0 14px',
  lineHeight: 1.55,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
  padding: '3px 0',
};

const metaLabel: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '1.5px',
};

const metaValue: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  textAlign: 'right',
  overflowWrap: 'anywhere',
};
