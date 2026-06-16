import { Link } from 'react-router-dom';
import type { BotInfo } from '../../lib/api';

/* ── MetricCard ───────────────────────────────────────────── */

export function MetricCard({ label, value, linkTo }: { label: string; value: string; linkTo?: string }) {
  return (
    <div className="card card-clickable" style={{ padding: 'var(--space-lg)' }}>
      <p className="metric-value">
        <span className={value !== '0' ? 'number-animate' : ''}>{value}</span>
      </p>
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
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)', opacity: 0.6 }}>Chat &rarr;</span>
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
