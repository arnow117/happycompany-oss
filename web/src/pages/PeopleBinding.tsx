import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCcw, UserRoundCheck, ChevronRight, X } from 'lucide-react';
import { api, type Employee, type EnterprisePerson } from '../lib/api';
import { useChatStore } from '../stores/chat';

const TENANT_RE = /^[a-z][a-z0-9-]*$/;

function safeTenant(value: string | null): string {
  const tenant = value?.trim() || 'acme';
  return TENANT_RE.test(tenant) ? tenant : 'acme';
}

export function PeopleBinding() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTenant = safeTenant(searchParams.get('tenant'));
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const setSelectedTenant = useChatStore((state) => state.setSelectedTenant);
  const [people, setPeople] = useState<EnterprisePerson[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeTenant, setActiveTenant] = useState(searchParams.get('tenant') ? initialTenant : selectedTenant || initialTenant);
  const [tenantDraft, setTenantDraft] = useState(searchParams.get('tenant') ? initialTenant : selectedTenant || initialTenant);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncText, setSyncText] = useState<string | null>(null);

  // Side panel state
  const [panelPerson, setPanelPerson] = useState<EnterprisePerson | null>(null);
  const [draftEntry, setDraftEntry] = useState<string>('');
  const [draftMode, setDraftMode] = useState<'bound' | 'selector'>('bound');
  const [draftVisible, setDraftVisible] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [peopleRes, employeeRes] = await Promise.all([
        api.listEnterprisePeople(activeTenant),
        api.listEmployees(activeTenant),
      ]);
      setPeople(peopleRes.people);
      setEmployees(employeeRes.employees);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载企业员工失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTenantDraft(activeTenant);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tenant', activeTenant);
      return next;
    }, { replace: true });
    void load();
  }, [activeTenant]);

  useEffect(() => {
    if (!selectedTenant || selectedTenant === activeTenant) return;
    setActiveTenant(selectedTenant);
    setPanelPerson(null);
    setSyncText(null);
  }, [activeTenant, selectedTenant]);

  const activeCount = people.filter((p) => p.status === 'active').length;
  const boundCount = people.filter((p) => Boolean(p.entryEmployee)).length;

  const applyTenant = () => {
    const nextTenant = tenantDraft.trim();
    if (!TENANT_RE.test(nextTenant)) {
      setError('租户名称必须以小写字母开头，只能包含小写字母、数字和连字符');
      return;
    }
    setActiveTenant(nextTenant);
    setSelectedTenant(nextTenant);
    setPanelPerson(null);
    setSyncText(null);
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncText(null);
    try {
      const res = await api.syncEnterprisePeople(activeTenant);
      setPeople(res.people);
      setSyncText(`新增 ${res.sync.created}，更新 ${res.sync.updated}，停用 ${res.sync.inactive}，共 ${res.sync.total}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '同步通讯录失败');
    } finally {
      setSyncing(false);
    }
  };

  const openPanel = (person: EnterprisePerson) => {
    setPanelPerson(person);
    setDraftEntry(person.entryEmployee || '');
    setDraftMode(person.routingMode || 'bound');
    setDraftVisible(person.visibleEmployees || []);
    setError(null);
  };

  const closePanel = () => {
    setPanelPerson(null);
  };

  const handleSave = async () => {
    if (!panelPerson) return;
    setSaving(true);
    setError(null);
    try {
      const bindingBody = draftMode === 'selector'
        ? {
            tenant: activeTenant,
            entryEmployee: draftEntry || '',
            routingMode: draftMode,
            visibleEmployees: draftVisible,
          }
        : {
            tenant: activeTenant,
            entryEmployee: draftEntry,
            routingMode: draftMode,
            visibleEmployees: draftVisible,
          };
      const res = await api.bindEnterprisePerson(panelPerson.userId, {
        ...bindingBody,
      });
      setPeople((prev) => prev.map((item) => item.userId === panelPerson.userId ? res.person : item));
      setPanelPerson(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存绑定失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClearBinding = async () => {
    if (!panelPerson) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.bindEnterprisePerson(panelPerson.userId, {
        tenant: activeTenant,
        entryEmployee: '',
      });
      setPeople((prev) => prev.map((item) => item.userId === panelPerson.userId ? res.person : item));
      setPanelPerson(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '解除绑定失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleVisible = (id: string) => {
    setDraftVisible((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllVisible = () => {
    setDraftVisible(employees.map((e) => e.id));
  };

  const clearVisible = () => {
    setDraftVisible([]);
  };

  if (loading) return <div className="loading-state">加载企业员工...</div>;

  const panelOpen = panelPerson !== null;

  return (
    <div style={page}>
      <div style={{ ...container, ...(panelOpen ? containerShifted : {}) }}>
        {/* Header */}
        <div style={header}>
          <div>
            <div style={stepTag}>第 3 步，共 3 步</div>
            <h2 style={heading}>人员绑定</h2>
            <p style={subheading}>
              为企业员工配置入口员工、路由模式和可见范围。
            </p>
          </div>
          <div style={headerActions}>
            <input
              value={tenantDraft}
              onChange={(e) => setTenantDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyTenant();
              }}
              style={tenantInput}
              aria-label="企业租户"
            />
            <button
              type="button"
              onClick={applyTenant}
              disabled={loading || tenantDraft.trim() === activeTenant}
              style={loading || tenantDraft.trim() === activeTenant ? { ...secondaryBtn, ...btnDisabled } : secondaryBtn}
            >
              切换租户
            </button>
            <button type="button" onClick={handleSync} disabled={syncing} style={syncing ? { ...primaryBtn, ...btnDisabled } : primaryBtn}>
              <RefreshCcw size={15} />
              {syncing ? '同步中' : '同步通讯录'}
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div style={metrics}>
          <Metric label="活跃员工" value={activeCount} />
          <Metric label="已绑定入口" value={boundCount} />
          <Metric label="未绑定" value={Math.max(activeCount - boundCount, 0)} accent />
        </div>

        {error && !panelOpen && <div style={errorBanner}>{error}</div>}
        {syncText && <div style={notice}>{syncText}</div>}

        {/* People list */}
        {people.length === 0 ? (
          <div style={emptyState}>还没有员工数据，先同步钉钉通讯录。</div>
        ) : (
          <div style={listSection}>
            {people.map((person) => {
              const isBound = Boolean(person.entryEmployee);
              const boundEmployee = isBound
                ? employees.find((e) => e.id === person.entryEmployee)
                : null;

              return (
                <button
                  key={person.userId}
                  type="button"
                  onClick={() => openPanel(person)}
                  style={personRow}
                >
                  <div style={personLeft}>
                    <div style={avatarIcon}>
                      <UserRoundCheck size={16} />
                    </div>
                    <div style={personInfo}>
                      <span style={personName}>{person.name}</span>
                      <span style={personMeta}>
                        {person.departments.map((d) => d.name).join(' / ') || '未分配部门'}
                      </span>
                    </div>
                  </div>
                  <div style={personRight}>
                    <span style={personStatus(person.status)}>
                      {person.status === 'active' ? '在职' : '停用'}
                    </span>
                    <span style={bindingBadge(isBound)}>
                      {isBound
                        ? boundEmployee?.displayName || person.entryEmployee
                        : '未绑定'}
                    </span>
                    <ChevronRight size={16} color="var(--color-on-dark-soft)" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Side Panel */}
      {panelOpen && panelPerson && (
        <div style={overlay} onClick={closePanel}>
          <div style={panel} onClick={(e) => e.stopPropagation()}>
            {/* Panel header */}
            <div style={panelHeader}>
              <div style={panelHeaderInfo}>
                <strong style={panelTitle}>{panelPerson.name}</strong>
                <span style={panelSubtitle}>
                  {panelPerson.departments.map((d) => d.name).join(' / ') || '未分配部门'}
                </span>
              </div>
              <button type="button" onClick={closePanel} style={panelCloseBtn} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            {error && <div style={panelError}>{error}</div>}

            {/* Entry Employee */}
            <div style={fieldGroup}>
              <label style={fieldLabel}>
                入口员工
                <span style={fieldHint}>该用户发消息时默认进入哪个员工的会话</span>
              </label>
              <select
                value={draftEntry}
                onChange={(e) => setDraftEntry(e.target.value)}
                style={fieldSelect}
                aria-label="选择入口员工"
              >
                <option value="">选择入口员工...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Routing Mode */}
            <div style={fieldGroup}>
              <label style={fieldLabel}>
                路由模式
                <span style={fieldHint}>
                  {draftMode === 'bound'
                    ? '自动路由到入口员工，用户也可通过 /list 切换'
                    : '每次发消息前让用户选择对话对象'}
                </span>
              </label>
              <div style={radioGroup}>
                <label style={radioOption(draftMode === 'bound')}>
                  <input
                    type="radio"
                    name="routing-mode"
                    value="bound"
                    checked={draftMode === 'bound'}
                    onChange={() => setDraftMode('bound')}
                    style={radioInput}
                  />
                  <span style={radioLabel}>
                    <span style={radioTitle}>自动路由</span>
                    <span style={radioDesc}>消息直接进入入口员工</span>
                  </span>
                </label>
                <label style={radioOption(draftMode === 'selector')}>
                  <input
                    type="radio"
                    name="routing-mode"
                    value="selector"
                    checked={draftMode === 'selector'}
                    onChange={() => setDraftMode('selector')}
                    style={radioInput}
                  />
                  <span style={radioLabel}>
                    <span style={radioTitle}>每次选择</span>
                    <span style={radioDesc}>每次让用户选对话对象</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Visible Employees */}
            <div style={fieldGroup}>
              <div style={visibleHeader}>
                <label style={fieldLabel}>
                  可见员工范围
                  <span style={fieldHint}>该用户可以切换到哪些员工（{draftVisible.length} / {employees.length}）</span>
                </label>
                <div style={visibleActions}>
                  <button type="button" onClick={selectAllVisible} style={linkBtn}>全选</button>
                  <button type="button" onClick={clearVisible} style={linkBtn}>清空</button>
                </div>
              </div>
              <div style={visibleList}>
                {employees.map((emp) => (
                  <label key={emp.id} style={visibleItem(draftVisible.includes(emp.id))}>
                    <input
                      type="checkbox"
                      checked={draftVisible.includes(emp.id)}
                      onChange={() => toggleVisible(emp.id)}
                      style={checkboxInput}
                    />
                    <span style={visibleItemName}>{emp.displayName}</span>
                    {emp.description && (
                      <span style={visibleItemDesc}>{emp.description.split('\n')[0]}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Panel actions */}
            <div style={panelActions}>
              {panelPerson.entryEmployee && (
                <button
                  type="button"
                  onClick={handleClearBinding}
                  disabled={saving}
                  style={saving ? { ...dangerBtn, ...btnDisabled } : dangerBtn}
                >
                  解除绑定
                </button>
              )}
              <button type="button" onClick={closePanel} style={cancelBtn}>
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (draftMode === 'bound' && !draftEntry) || (draftMode === 'selector' && draftVisible.length === 0)}
                style={saving || (draftMode === 'bound' && !draftEntry) || (draftMode === 'selector' && draftVisible.length === 0) ? { ...saveBtn, ...btnDisabled } : saveBtn}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={metric}>
      <span style={{ ...metricValue, ...(accent && value > 0 ? { color: 'var(--color-accent)' } : {}) }}>
        {value}
      </span>
      <span style={metricLabel}>{label}</span>
    </div>
  );
}

/* ── Page Layout ────────────────────────────────────────── */

const page: React.CSSProperties = {
  position: 'relative',
  padding: '24px 16px',
  display: 'flex',
  justifyContent: 'center',
  minHeight: '100vh',
};

const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '720px',
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  transition: 'margin-right 200ms ease',
};

const containerShifted: React.CSSProperties = {
  marginRight: '380px',
};

const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
};

const headerActions: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexShrink: 0,
};

const stepTag: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  marginBottom: '6px',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--color-on-dark)',
};

const subheading: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '14px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

const tenantInput: React.CSSProperties = {
  width: 120,
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
  color: 'var(--color-on-dark)',
  fontSize: '13px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnDisabled: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'wait',
};

/* ── Metrics ────────────────────────────────────────────── */

const metrics: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '12px',
};

const metric: React.CSSProperties = {
  padding: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
};

const metricValue: React.CSSProperties = {
  display: 'block',
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--color-on-dark)',
};

const metricLabel: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
};

/* ── Error / Notice ─────────────────────────────────────── */

const errorBanner: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
  fontSize: '13px',
};

const notice: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(74, 222, 128, 0.06)',
  border: '1px solid rgba(74, 222, 128, 0.2)',
  color: '#4ade80',
  fontSize: '13px',
};

const emptyState: React.CSSProperties = {
  padding: '48px 24px',
  textAlign: 'center',
  color: 'var(--color-on-dark-soft)',
  fontSize: '14px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
};

/* ── People List ────────────────────────────────────────── */

const listSection: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-surface-dark-elevated)',
  overflow: 'hidden',
};

const personRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 18px',
  background: 'var(--color-surface-dark)',
  border: 'none',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
  color: 'var(--color-on-dark)',
  transition: 'background 120ms',
};

const personLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
};

const avatarIcon: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: 'var(--color-surface-dark-elevated)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  color: 'var(--color-accent)',
};

const personInfo: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const personName: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const personMeta: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const personRight: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
};

const personStatus = (status: string): React.CSSProperties => ({
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: status === 'active' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(156, 163, 175, 0.1)',
  color: status === 'active' ? '#4ade80' : '#9ca3af',
});

const bindingBadge = (isBound: boolean): React.CSSProperties => ({
  fontSize: '12px',
  padding: '3px 10px',
  borderRadius: 'var(--radius-sm)',
  background: isBound ? 'rgba(74, 222, 128, 0.08)' : 'rgba(249, 115, 22, 0.08)',
  border: isBound ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid rgba(249, 115, 22, 0.2)',
  color: isBound ? '#4ade80' : 'var(--color-accent)',
});

/* ── Side Panel ─────────────────────────────────────────── */

const overlay: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  background: 'rgba(0, 0, 0, 0.3)',
  zIndex: 100,
  display: 'flex',
  justifyContent: 'flex-end',
};

const panel: React.CSSProperties = {
  width: '360px',
  height: '100%',
  background: 'var(--color-surface-dark)',
  borderLeft: '1px solid var(--color-surface-dark-elevated)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const panelHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: '24px 20px 16px',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
};

const panelHeaderInfo: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const panelTitle: React.CSSProperties = {
  fontSize: '17px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const panelSubtitle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-on-dark-soft)',
};

const panelCloseBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-on-dark-soft)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
};

const panelError: React.CSSProperties = {
  margin: '12px 20px 0',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
  fontSize: '13px',
};

/* ── Panel Fields ───────────────────────────────────────── */

const fieldGroup: React.CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
};

const fieldLabel: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const fieldHint: React.CSSProperties = {
  fontWeight: 400,
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.4,
};

const fieldSelect: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
  color: 'var(--color-on-dark)',
  fontSize: '14px',
  outline: 'none',
};

/* ── Radio Group ────────────────────────────────────────── */

const radioGroup: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const radioOption = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-surface-dark-elevated)',
  background: active ? 'rgba(249, 115, 22, 0.05)' : 'transparent',
  cursor: 'pointer',
  transition: 'border-color 120ms, background 120ms',
});

const radioInput: React.CSSProperties = {
  marginTop: 3,
  accentColor: 'var(--color-accent)',
};

const radioLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const radioTitle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const radioDesc: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
};

/* ── Visible Employees ──────────────────────────────────── */

const visibleHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};

const visibleActions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: '12px',
  cursor: 'pointer',
  padding: '2px 0',
};

const visibleList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 240,
  overflowY: 'auto',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  padding: 4,
};

const visibleItem = (checked: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  background: checked ? 'rgba(249, 115, 22, 0.05)' : 'transparent',
  cursor: 'pointer',
});

const checkboxInput: React.CSSProperties = {
  accentColor: 'var(--color-accent)',
};

const visibleItemName: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark)',
};

const visibleItemDesc: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--color-on-dark-soft)',
  marginLeft: 'auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 120,
};

/* ── Panel Actions ──────────────────────────────────────── */

const panelActions: React.CSSProperties = {
  marginTop: 'auto',
  padding: '16px 20px',
  borderTop: '1px solid var(--color-surface-dark-elevated)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelBtn: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  marginRight: 'auto',
  padding: '9px 14px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(248, 113, 113, 0.3)',
  background: 'rgba(248, 113, 113, 0.08)',
  color: '#f87171',
  fontSize: '13px',
  cursor: 'pointer',
};

const saveBtn: React.CSSProperties = {
  padding: '9px 20px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};
