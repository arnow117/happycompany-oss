import { Building2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

export function TenantSwitcher() {
  const tenants = useChatStore((s) => s.tenants);
  const selectedTenant = useChatStore((s) => s.selectedTenant);
  const setSelectedTenant = useChatStore((s) => s.setSelectedTenant);
  const currentTenant = tenants.find((tenant) => tenant.id === selectedTenant) ?? tenants[0];
  const duplicateNames = new Set(
    tenants
      .map((tenant) => tenant.displayName)
      .filter((name, index, list) => list.indexOf(name) !== index),
  );

  if (!currentTenant) return null;

  return (
    <div style={s.wrapper}>
      <div style={s.labelRow}>
        <Building2 size={14} color="var(--color-on-dark-muted)" />
        <span style={s.label}>当前企业</span>
      </div>
      {tenants.length > 1 ? (
        <select
          aria-label="切换企业"
          value={currentTenant.id}
          onChange={(event) => {
            setSelectedTenant(event.target.value);
            useChatStore.getState().resetConversation();
          }}
          style={s.select}
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {duplicateNames.has(tenant.displayName) ? `${tenant.displayName} · ${tenant.id}` : tenant.displayName}
            </option>
          ))}
        </select>
      ) : (
        <div style={s.currentTenant} title={currentTenant.description || currentTenant.id}>
          {currentTenant.displayName}
        </div>
      )}
      <span style={s.tenantId}>{currentTenant.id}</span>
    </div>
  );
}

const s = {
  wrapper: {
    display: 'grid',
    gap: '6px',
    padding: '0 12px 12px',
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  label: {
    color: 'var(--color-on-dark-muted)',
    fontSize: '11px',
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
  },
  currentTenant: {
    minHeight: '32px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-surface-dark-elevated)',
    background: 'var(--color-surface-dark-elevated)',
    color: 'var(--color-on-dark)',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  select: {
    width: '100%',
    minHeight: '32px',
    padding: '0 30px 0 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-surface-dark-elevated)',
    background: 'var(--color-surface-dark-elevated)',
    color: 'var(--color-on-dark)',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
    cursor: 'pointer',
    outline: 'none',
  },
  tenantId: {
    color: 'var(--color-on-dark-muted)',
    fontSize: '10px',
    lineHeight: 1,
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};
