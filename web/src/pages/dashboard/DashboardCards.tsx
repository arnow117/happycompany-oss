import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BotInfo } from '../../lib/api';

/* ── MetricCard ───────────────────────────────────────────── */

export function MetricCard({
  label,
  value,
  linkTo,
  icon,
  accent,
}: {
  label: string;
  value: string;
  linkTo?: string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  const isEmpty = value === '0';
  const valueClass = isEmpty
    ? 'metric-value metric-value--empty'
    : accent
      ? 'metric-value metric-value--accent number-animate'
      : 'metric-value number-animate';

  return (
    <div className="card card-clickable" style={{ padding: 'var(--space-lg)' }}>
      <div className="metric-card-head">
        {icon && (
          <span
            className="metric-card-icon"
            style={{
              background: accent && !isEmpty ? 'var(--color-accent-dim)' : 'var(--color-bg-raised)',
              color: accent && !isEmpty ? 'var(--color-accent)' : 'var(--color-text-muted-soft)',
            }}
          >
            {icon}
          </span>
        )}
        <p className="metric-label">
          {linkTo ? (
            <Link to={linkTo} className="metric-link">
              {label} &rarr;
            </Link>
          ) : (
            label
          )}
        </p>
      </div>
      <p className={valueClass}>{isEmpty ? '暂无' : value}</p>
    </div>
  );
}

/* ── BotCard ──────────────────────────────────────────────── */

export function BotCard({ bot }: { bot: BotInfo }) {
  const isOnline = bot.status === 'running';
  const routeLabel = bot.routingMode === 'employee-director' ? '员工调度' : '直连';
  const tenantLabel = bot.tenant ? ` · ${bot.tenant}` : '';
  return (
    <Link
      to={`/chat/${encodeURIComponent(bot.name)}`}
      className="card card-clickable"
      style={{ display: 'block', padding: 'var(--space-lg)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className={isOnline ? 'online-indicator' : 'offline-indicator'} style={{ width: '8px', height: '8px', flexShrink: 0 }} />
        <span className="bot-name" style={{ fontSize: '15px' }}>{bot.displayName || bot.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)', opacity: 0.6 }}>对话 &rarr;</span>
      </div>
      <p className="muted-text" style={{ margin: '6px 0 0', fontSize: '13px' }}>
        {bot.channel} &middot; {routeLabel}{tenantLabel}
      </p>
    </Link>
  );
}

/* ── ActionLink ───────────────────────────────────────────── */

export function ActionLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="action-link">
      {label}
      <span aria-hidden="true" style={{ marginLeft: '8px', opacity: 0.5 }}>&rarr;</span>
    </Link>
  );
}

/* ── ErrorBlock ───────────────────────────────────────────── */

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="error-block">
      {message}
    </div>
  );
}
