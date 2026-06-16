import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, UserRoundCheck } from 'lucide-react';
import { api, type Employee, type EnterprisePerson } from '../lib/api';
import { useChatStore } from '../stores/chat';

const ROLES = ['sales', 'finance', 'maintenance', 'hr', 'admin', 'member'];

export function EnterprisePeople() {
  const [people, setPeople] = useState<EnterprisePerson[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const tenants = useChatStore((state) => state.tenants);
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const setTenants = useChatStore((state) => state.setTenants);
  const setSelectedTenant = useChatStore((state) => state.setSelectedTenant);
  const tenant = selectedTenant || tenants[0]?.id || 'acme';
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncText, setSyncText] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [peopleRes, employeeRes] = await Promise.all([
        api.listEnterprisePeople(tenant),
        api.listEmployees(tenant),
      ]);
      setPeople(peopleRes.people);
      setEmployees(employeeRes.employees);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载企业员工失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenant]);
  useEffect(() => {
    if (tenants.length > 0) return;
    api.listTenants()
      .then((res) => setTenants(res.tenants))
      .catch(() => {});
  }, [setTenants, tenants.length]);

  const activeCount = people.filter((p) => p.status === 'active').length;
  const boundCount = people.filter((p) => Boolean(p.entryEmployee || p.assistantId)).length;

  const employeesByRole = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const employee of employees) {
      const list = map.get(employee.role || 'member') ?? [];
      list.push(employee);
      map.set(employee.role || 'member', list);
    }
    return map;
  }, [employees]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncText(null);
    try {
      const res = await api.syncEnterprisePeople(tenant);
      setPeople(res.people);
      setSyncText(`新增 ${res.sync.created}，更新 ${res.sync.updated}，停用 ${res.sync.inactive}，共 ${res.sync.total}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '同步通讯录失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleBind = async (person: EnterprisePerson, patch: { role?: string | null; entryEmployee?: string | null }) => {
    setSavingUserId(person.userId);
    setError(null);
    try {
      const entryEmployee = patch.entryEmployee ?? undefined;
      const res = await api.bindEnterprisePerson(person.userId, {
        tenant,
        role: patch.role,
        entryEmployee: entryEmployee === null ? '' : entryEmployee,
        routingMode: entryEmployee ? 'bound' : undefined,
        visibleEmployees: entryEmployee ? [] : undefined,
      });
      setPeople((prev) => prev.map((item) => item.userId === person.userId ? res.person : item));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存绑定失败');
    } finally {
      setSavingUserId(null);
    }
  };

  if (loading) return <div className="loading-state">加载企业员工...</div>;

  return (
    <section className="page-enter">
      <div style={s.header}>
        <div>
          <h2 className="heading">企业员工</h2>
          <p className="subtitle">同步钉钉通讯录，把真人 userId 映射到角色、个人助手或企业调度员。</p>
        </div>
        <div style={s.headerActions}>
          <select
            value={tenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            style={s.tenantInput}
            aria-label="企业租户"
          >
            {(tenants.length > 0 ? tenants : [{ id: tenant, displayName: tenant }]).map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
          <button type="button" onClick={handleSync} disabled={syncing} style={syncing ? { ...s.primaryButton, ...s.buttonDisabled } : s.primaryButton}>
            <RefreshCcw size={16} />
            {syncing ? '同步中' : '同步钉钉'}
          </button>
        </div>
      </div>

      <div style={s.metrics}>
        <Metric label="活跃员工" value={activeCount} />
        <Metric label="已绑定助手" value={boundCount} />
        <Metric label="未绑定" value={Math.max(activeCount - boundCount, 0)} />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {syncText && <div style={s.notice}>{syncText}</div>}

      {people.length === 0 ? (
        <div className="empty-state">还没有员工数据，先同步钉钉通讯录。</div>
      ) : (
        <div style={s.table}>
          <div style={s.tableHeader}>
            <span>员工</span>
            <span>部门</span>
            <span>状态</span>
            <span>角色</span>
            <span>个人助手</span>
          </div>
          {people.map((person) => {
            const roleEmployees = person.role ? (employeesByRole.get(person.role) ?? employees) : employees;
            const boundEntry = person.entryEmployee || person.assistantId || '';
            return (
              <div key={person.userId} style={s.row}>
                <div style={s.personCell}>
                  <UserRoundCheck size={17} color="var(--color-accent-active)" />
                  <div style={s.stack}>
                    <strong>{person.name}</strong>
                    <span style={s.mono}>{person.userId}</span>
                  </div>
                </div>
                <span style={s.deptCell}>{person.departments.map((d) => d.name).join(' / ') || '-'}</span>
                <span className={`status-badge ${person.status === 'active' ? 'status-badge--success' : 'status-badge--offline'}`}>
                  {person.status === 'active' ? '在职' : '停用'}
                </span>
                <select
                  value={person.role || ''}
                  disabled={savingUserId === person.userId}
                  onChange={(e) => void handleBind(person, { role: e.target.value || null })}
                  style={s.select}
                  aria-label={`设置 ${person.name} 的角色`}
                >
                  <option value="">未分配角色</option>
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <select
                  value={boundEntry}
                  disabled={savingUserId === person.userId}
                  onChange={(e) => void handleBind(person, { entryEmployee: e.target.value || null })}
                  style={s.select}
                  aria-label={`绑定 ${person.name} 的个人助手`}
                >
                  <option value="">企业调度员</option>
                  {roleEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.displayName} · {employee.id}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={s.metric}>
      <span style={s.metricValue}>{value}</span>
      <span style={s.metricLabel}>{label}</span>
    </div>
  );
}

const s = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    alignItems: 'flex-start',
    marginBottom: 'var(--space-lg)',
  } as React.CSSProperties,
  headerActions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' } as React.CSSProperties,
  tenantInput: {
    width: 140,
    padding: '9px 11px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-accent-active)',
    background: 'var(--color-accent)',
    color: 'var(--color-on-accent)',
    cursor: 'pointer',
    fontWeight: 600,
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.65,
    cursor: 'wait',
  } as React.CSSProperties,
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    marginBottom: 'var(--space-lg)',
  } as React.CSSProperties,
  metric: {
    padding: 'var(--space-md)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-bg-raised)',
  } as React.CSSProperties,
  metricValue: { display: 'block', fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)' } as React.CSSProperties,
  metricLabel: { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' } as React.CSSProperties,
  notice: {
    marginBottom: 'var(--space-md)',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-success-bg)',
    color: 'var(--color-success)',
  } as React.CSSProperties,
  table: {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    overflowX: 'auto',
    background: 'var(--color-bg-base)',
  } as React.CSSProperties,
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1.1fr) minmax(180px, 1fr) 92px 150px minmax(260px, 1.2fr)',
    minWidth: 960,
    gap: 'var(--space-sm)',
    padding: '10px var(--space-md)',
    background: 'var(--color-bg-raised)',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
  } as React.CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1.1fr) minmax(180px, 1fr) 92px 150px minmax(260px, 1.2fr)',
    minWidth: 960,
    gap: 'var(--space-sm)',
    alignItems: 'center',
    padding: '12px var(--space-md)',
    borderBottom: '1px solid var(--color-border-soft)',
  } as React.CSSProperties,
  personCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } as React.CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', minWidth: 0 } as React.CSSProperties,
  mono: { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  deptCell: { color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  select: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,
};
