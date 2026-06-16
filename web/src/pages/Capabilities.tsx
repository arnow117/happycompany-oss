import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { FileText, GitBranch, LockKeyhole, RefreshCw, ShieldCheck, UserCog, Wrench } from 'lucide-react';
import { api, type Employee, type EmployeeCapabilityReport } from '../lib/api';
import { useChatStore } from '../stores/chat';

function riskStyle(riskLevel: string): CSSProperties {
  if (riskLevel === 'destructive' || riskLevel === 'external') return s.riskDanger;
  if (riskLevel === 'internal_write') return s.riskWarn;
  if (riskLevel === 'unknown') return s.riskUnknown;
  return s.riskRead;
}

function isReviewRequired(riskLevel: string): boolean {
  return riskLevel === 'internal_write' || riskLevel === 'destructive' || riskLevel === 'external';
}

function runtimeTools(report: EmployeeCapabilityReport) {
  return report.tools.filter((tool) => tool.registered && tool.allowed);
}

function runtimeSkills(report: EmployeeCapabilityReport) {
  return report.skills.filter((skill) => skill.installed && skill.allowed);
}

function reviewRequiredCount(report: EmployeeCapabilityReport): number {
  return runtimeTools(report).filter((tool) => isReviewRequired(tool.riskLevel)).length;
}

function statusText(report: EmployeeCapabilityReport): string {
  const reviewCount = reviewRequiredCount(report);
  if (reviewCount > 0) return `${reviewCount} 个需确认`;
  if (runtimeTools(report).length === 0 && runtimeSkills(report).length === 0) return '协作型';
  return '可用';
}

function statusStyle(report: EmployeeCapabilityReport): CSSProperties {
  return reviewRequiredCount(report) > 0 ? s.warnBadge : s.okBadge;
}

export function Capabilities() {
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const tenants = useChatStore((state) => state.tenants);
  const tenant = selectedTenant || tenants[0]?.id || 'acme-happycompany';
  const [reports, setReports] = useState<EmployeeCapabilityReport[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [capabilityRes, employeeRes] = await Promise.all([
        api.listCapabilities(tenant),
        api.listEmployees(tenant),
      ]);
      setReports(capabilityRes.employees);
      setEmployees(employeeRes.employees);
      setSelectedId((current) => current && capabilityRes.employees.some((item) => item.employeeId === current)
        ? current
        : capabilityRes.employees[0]?.employeeId ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载能力注册失败');
      setReports([]);
      setEmployees([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tenant]);

  const selected = useMemo(
    () => reports.find((report) => report.employeeId === selectedId) ?? reports[0] ?? null,
    [reports, selectedId],
  );
  const selectedEmployee = useMemo(
    () => selected ? employees.find((employee) => employee.id === selected.employeeId) ?? null : null,
    [employees, selected],
  );
  const selectedRuntimeSkills = useMemo(() => selected ? runtimeSkills(selected) : [], [selected]);
  const selectedRuntimeTools = useMemo(() => selected ? runtimeTools(selected) : [], [selected]);

  const totals = useMemo(() => ({
    employees: reports.length,
    skills: reports.reduce((sum, report) => sum + runtimeSkills(report).length, 0),
    tools: reports.reduce((sum, report) => sum + runtimeTools(report).length, 0),
    reviewRequired: reports.reduce((sum, report) => sum + reviewRequiredCount(report), 0),
  }), [reports]);

  return (
    <section style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.heading}>员工配置台</h2>
          <p style={s.sub}>数字员工定义、Prompt、工作目录、Skills、Tools、权限边界和可调度对象</p>
        </div>
        <button type="button" style={s.iconButton} onClick={() => void load()} disabled={loading} title="刷新">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}

      <div style={s.metrics}>
        <Metric label="员工" value={totals.employees} />
        <Metric label="Skills" value={totals.skills} />
        <Metric label="Tools" value={totals.tools} />
        <Metric label="需确认" value={totals.reviewRequired} tone={totals.reviewRequired > 0 ? 'warn' : 'ok'} />
      </div>

      <div style={s.grid}>
        <section style={s.listPanel}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>员工能力清单</h3>
            <span style={s.panelMeta}>{loading ? 'loading' : `${reports.length} total`}</span>
          </div>
          <div style={s.employeeList}>
            {reports.map((report) => (
              <button
                key={`${report.tenant}:${report.employeeId}`}
                type="button"
                style={{ ...s.employeeButton, ...(selected?.employeeId === report.employeeId ? s.employeeButtonActive : {}) }}
                onClick={() => setSelectedId(report.employeeId)}
              >
                <span style={s.employeeTop}>
                  <strong style={s.employeeName}>{report.displayName}</strong>
                  <span style={statusStyle(report)}>{statusText(report)}</span>
                </span>
                <span style={s.employeeMeta}>{report.employeeId} · {report.role}</span>
                <span style={s.employeeStats}>{runtimeSkills(report).length} skills · {runtimeTools(report).length} tools · {report.summary.handoffTargetCount} targets</span>
              </button>
            ))}
            {!loading && reports.length === 0 && <div style={s.empty}>当前租户还没有数字员工。</div>}
          </div>
        </section>

        <section style={s.detailPanel}>
          {!selected ? (
            <div style={s.empty}>选择一个员工查看能力边界。</div>
          ) : (
            <div style={s.detail}>
              <div style={s.detailHeader}>
                <div>
                  <h3 style={s.detailTitle}>{selected.displayName}</h3>
                  <p style={s.detailSub}>{selected.tenant} / {selected.employeeId} / {selected.role}</p>
                </div>
                <span style={statusStyle(selected)}>{statusText(selected)}</span>
              </div>

              <div style={s.identityGrid}>
                <InfoRow icon={<UserCog size={16} />} label="员工定义" value={`corp/${selected.tenant}/employees/${selected.employeeId}.yaml`} />
                <InfoRow icon={<FileText size={16} />} label="模型" value={selectedEmployee?.model || '-'} />
                <InfoRow icon={<GitBranch size={16} />} label="Workspace" value={selected.workspace.absolute} />
                <InfoRow icon={<ShieldCheck size={16} />} label="来源" value={`${selectedEmployee?.source ?? '-'} · ${selectedEmployee?.createdAt ? new Date(selectedEmployee.createdAt).toLocaleString('zh-CN') : '-'}`} />
              </div>

              {selectedEmployee && (
                <section style={s.configPanel}>
                  <div style={s.configHeader}>
                    <h4 style={s.sectionTitle}>员工 YAML 配置</h4>
                    <span style={s.panelMeta}>{selectedEmployee.id}</span>
                  </div>
                  <div style={s.configGrid}>
                    <ConfigItem label="职责描述" value={selectedEmployee.description || '-'} />
                    <ConfigItem label="角色" value={selectedEmployee.role || '-'} />
                    <ConfigItem label="绑定用户" value={selectedEmployee.humanUserId || '未绑定'} />
                    <ConfigItem label="Workspace" value={selectedEmployee.workspace || `agents/${selectedEmployee.id}`} />
                    <ConfigItem label="声明 Skills" value={selectedEmployee.skills.length ? selectedEmployee.skills.join(', ') : '无'} />
                    <ConfigItem label="声明 Tools" value={selectedEmployee.tools.length ? selectedEmployee.tools.join(', ') : '无'} />
                    <ConfigItem label="可转交对象" value={(selectedEmployee.allowedTargets ?? []).length ? (selectedEmployee.allowedTargets ?? []).join(', ') : '无'} />
                    <ConfigItem label="计划任务" value={formatSchedule(selectedEmployee.schedule)} />
                  </div>
                  <div style={s.promptBox}>
                    <span style={s.promptLabel}>System Prompt</span>
                    <pre style={s.promptPre}>{selectedEmployee.systemPrompt.trim() || '未配置 YAML systemPrompt'}</pre>
                  </div>
                </section>
              )}

              <div style={s.boundary}>
                <InfoRow icon={<ShieldCheck size={16} />} label="平台 MCP" value={selected.mcpBoundary.platformMcpVisible ? '可见：handoff / memory / 调度等平台能力' : '不可见'} />
                <InfoRow icon={<Wrench size={16} />} label="业务入口" value={selected.mcpBoundary.businessInterface === 'run_skill' ? '通过 run_skill 调用绑定 skill' : '旧 app-tools 直出'} />
                <InfoRow icon={<LockKeyhole size={16} />} label="业务 MCP 直出" value={selected.mcpBoundary.businessMcpDirectVisible ? '可见' : '默认隐藏'} />
                <InfoRow icon={<GitBranch size={16} />} label="工作目录" value={selected.workspace.relative} />
              </div>

              <CapabilitySection title="路由能力标签" emptyText="未配置能力标签">
                {selected.capabilities.map((capability) => <span key={capability} style={s.tag}>{capability}</span>)}
              </CapabilitySection>

              <CapabilitySection title="Skills" emptyText="未绑定 skill">
                {selectedRuntimeSkills.map((skill) => (
                  <div key={skill.name} style={s.rowCard}>
                    <div style={s.rowTop}>
                      <strong>{skill.displayName}</strong>
                      <span style={s.okBadge}>可用</span>
                    </div>
                    <span style={s.rowMeta}>{skill.name} · {skill.toolCount} tools</span>
                    {skill.description && <p style={s.rowDesc}>{skill.description}</p>}
                  </div>
                ))}
              </CapabilitySection>

              <CapabilitySection title="Tools" emptyText="未授权业务工具">
                {selectedRuntimeTools.map((tool) => (
                  <div key={tool.name} style={s.rowCard}>
                    <div style={s.rowTop}>
                      <strong>{tool.name}</strong>
                      <span style={{ ...s.riskBadge, ...riskStyle(tool.riskLevel) }}>{tool.riskLevel}</span>
                    </div>
                    <span style={s.rowMeta}>{isReviewRequired(tool.riskLevel) ? '调用前需要确认' : '可直接调用'}</span>
                    {tool.description && <p style={s.rowDesc}>{tool.description}</p>}
                  </div>
                ))}
              </CapabilitySection>

              <CapabilitySection title="可调度员工" emptyText="未配置 handoff target">
                {selected.handoffTargets.map((target) => (
                  <span key={target.employeeId} style={target.exists ? s.target : s.targetMissing}>
                    {target.displayName ?? target.employeeId}
                  </span>
                ))}
              </CapabilitySection>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{props.label}</span>
      <strong style={props.tone === 'warn' ? s.metricWarn : s.metricValue}>{props.value}</strong>
    </div>
  );
}

function InfoRow(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div style={s.infoRow}>
      <span style={s.infoIcon}>{props.icon}</span>
      <span style={s.infoLabel}>{props.label}</span>
      <strong style={s.infoValue}>{props.value}</strong>
    </div>
  );
}

function ConfigItem(props: { label: string; value: string }) {
  return (
    <div style={s.configItem}>
      <span style={s.configLabel}>{props.label}</span>
      <strong style={s.configValue}>{props.value}</strong>
    </div>
  );
}

function formatSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== 'object') return '无';
  const triggers = (schedule as { triggers?: unknown }).triggers;
  if (!Array.isArray(triggers) || triggers.length === 0) return '无';
  return `${triggers.length} 个触发器`;
}

function CapabilitySection(props: { title: string; emptyText: string; children: ReactNode }) {
  const children = Array.isArray(props.children) ? props.children.filter(Boolean) : props.children;
  const empty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <section style={s.section}>
      <h4 style={s.sectionTitle}>{props.title}</h4>
      <div style={s.sectionBody}>
        {empty ? <span style={s.muted}>{props.emptyText}</span> : children}
      </div>
    </section>
  );
}

const s: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--color-text)' },
  sub: { margin: '6px 0 0', color: 'var(--color-text-secondary)', fontSize: 13 },
  iconButton: { width: 36, height: 36, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  errorBanner: { padding: 12, borderRadius: 6, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 13 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 },
  metric: { border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 },
  metricLabel: { color: 'var(--color-text-secondary)', fontSize: 12 },
  metricValue: { color: 'var(--color-text)', fontSize: 22 },
  metricWarn: { color: '#b45309', fontSize: 22 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: 16, alignItems: 'start' },
  listPanel: { border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 6, overflow: 'hidden' },
  detailPanel: { border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 6, minWidth: 0 },
  panelHeader: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' },
  panelMeta: { color: 'var(--color-text-secondary)', fontSize: 12 },
  employeeList: { display: 'flex', flexDirection: 'column' },
  employeeButton: { border: 0, borderBottom: '1px solid var(--color-border)', background: 'transparent', padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5 },
  employeeButtonActive: { background: 'var(--color-bg-subtle)' },
  employeeTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  employeeName: { color: 'var(--color-text)', fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  employeeMeta: { color: 'var(--color-text-secondary)', fontSize: 12 },
  employeeStats: { color: 'var(--color-text-secondary)', fontSize: 12, fontFamily: 'var(--font-mono)' },
  detail: { padding: 16, display: 'flex', flexDirection: 'column', gap: 16 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  detailTitle: { margin: 0, color: 'var(--color-text)', fontSize: 20 },
  detailSub: { margin: '5px 0 0', color: 'var(--color-text-secondary)', fontSize: 12, fontFamily: 'var(--font-mono)' },
  okBadge: { borderRadius: 999, background: '#dcfce7', color: '#166534', border: '1px solid #86efac', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  warnBadge: { borderRadius: 999, background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  identityGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  configPanel: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 },
  configHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  configGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  configItem: { border: '1px solid var(--color-border)', background: 'var(--color-bg-subtle)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  configLabel: { color: 'var(--color-text-secondary)', fontSize: 12 },
  configValue: { color: 'var(--color-text)', fontSize: 12, overflowWrap: 'anywhere', lineHeight: 1.45 },
  promptBox: { border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' },
  promptLabel: { display: 'block', padding: '8px 10px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 12, background: 'var(--color-bg-subtle)' },
  promptPre: { margin: 0, padding: 10, maxHeight: 220, overflow: 'auto', color: 'var(--color-text)', background: 'transparent', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55 },
  boundary: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  infoRow: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, display: 'grid', gridTemplateColumns: '20px 88px minmax(0, 1fr)', gap: 8, alignItems: 'center', minWidth: 0 },
  infoIcon: { display: 'inline-flex', color: 'var(--color-primary)' },
  infoLabel: { color: 'var(--color-text-secondary)', fontSize: 12 },
  infoValue: { color: 'var(--color-text)', fontSize: 12, overflowWrap: 'anywhere' },
  warningBox: { border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 },
  warningTitle: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 },
  warningLine: { fontSize: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { margin: 0, color: 'var(--color-text)', fontSize: 14 },
  sectionBody: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  rowCard: { width: 'min(100%, 300px)', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  rowTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', color: 'var(--color-text)', fontSize: 13 },
  rowMeta: { color: 'var(--color-text-secondary)', fontSize: 12, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' },
  rowDesc: { margin: 0, color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.45 },
  tag: { borderRadius: 6, background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '3px 8px', fontSize: 12 },
  target: { borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '3px 8px', fontSize: 12 },
  targetMissing: { borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '3px 8px', fontSize: 12 },
  riskBadge: { borderRadius: 999, border: '1px solid', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  riskRead: { background: '#e0f2fe', color: '#075985', borderColor: '#7dd3fc' },
  riskWarn: { background: '#fffbeb', color: '#92400e', borderColor: '#fcd34d' },
  riskDanger: { background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' },
  riskUnknown: { background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 13 },
  empty: { padding: 16, color: 'var(--color-text-secondary)', fontSize: 13 },
};
