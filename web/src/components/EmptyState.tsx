import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** lucide icon element, e.g. <Users size={20} /> */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** primary call-to-action */
  action?: { label: string; onClick: () => void };
}

/**
 * Rich empty state: icon + reason + a single call-to-action.
 * Use this instead of a bare "暂无…" line on primary surfaces
 * (employees, memory, collaboration log, etc.) so the dead space
 * tells the user *why* it's empty and *what to do next*.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-rich page-enter">
      {icon && <span className="empty-rich__icon">{icon}</span>}
      <h3 className="empty-rich__title">{title}</h3>
      {description && <p className="empty-rich__desc">{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 'var(--space-xs)',
            padding: '8px 18px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-accent)',
            color: '#fff',
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--font-medium)',
            fontFamily: 'var(--font-body)',
            cursor: 'pointer',
            transition: 'background var(--transition-fast) var(--ease-out-expo)',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
