import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Play, RefreshCw, XCircle } from 'lucide-react';
import { api, type HarnessCaseSummary, type HarnessStepRun, type HarnessSuiteReport } from '../lib/api';
import { useChatStore } from '../stores/chat';

function statusIcon(status: 'passed' | 'failed' | 'error') {
  if (status === 'passed') return <CheckCircle2 size={16} color="#15803d" />;
  if (status === 'failed') return <XCircle size={16} color="#b91c1c" />;
  return <AlertTriangle size={16} color="#b45309" />;
}

function shortDescription(text?: string): string {
  if (!text) return '未填写描述';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function channelLabel(channel: string): string {
  if (channel === 'dingtalk') return '钉钉';
  if (channel === 'feishu') return '飞书';
  if (channel === 'web') return 'Web';
  if (channel === 'harness') return 'Harness';
  return channel;
}

function scopedReport(report: HarnessSuiteReport | null, tenant: string): HarnessSuiteReport | null {
  if (!report) return null;
  const results = report.results.filter((result) => result.case.input.tenant === tenant);
  const failed = results.filter((result) => result.status !== 'passed').length;
  return {
    ...report,
    summary: {
      passed: results.length - failed,
      failed,
      total: results.length,
    },
    results,
  };
}

function defaultStepForTenant(tenant: string, firstCase?: HarnessCaseSummary) {
  if (tenant === 'acme-happycompany') {
    return {
      workflowRunId: 'contract-service-chain-smoke',
      stepId: 'sales-contract-fields',
      employeeId: 'sales-zhangsan',
      tenant,
      userId: 'web-harness-user',
      prompt: '你是销售张三。请只完成销售签约字段确认，不要转交其他员工。查询并输出江山市人民医院 GE16排 CT 维保合同的客户、设备、合同期限、金额和付款条款。',
    };
  }
  return {
    workflowRunId: 'manual-acceptance',
    stepId: 'lookup',
    employeeId: firstCase?.expect.routedEmployee || firstCase?.input.botName || '',
    tenant: firstCase?.input.tenant || tenant,
    userId: 'web-harness-user',
    prompt: '查一下浙一医院维保合同',
  };
}

export function Harness() {
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const tenants = useChatStore((state) => state.tenants);
  const tenant = selectedTenant || tenants[0]?.id || 'acme-happycompany';
  const [cases, setCases] = useState<HarnessCaseSummary[]>([]);
  const [fixtureDir, setFixtureDir] = useState('');
  const [report, setReport] = useState<HarnessSuiteReport | null>(null);
  const [stepRuns, setStepRuns] = useState<HarnessStepRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningStep, setRunningStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stepForm, setStepForm] = useState(() => defaultStepForTenant(tenant));

  const selected = useMemo(
    () => report?.results.find((result) => result.case.id === selectedId) ?? report?.results[0],
    [report, selectedId],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [caseRes, reportRes, stepRunRes] = await Promise.all([
        api.listHarnessCases(tenant),
        api.getLatestHarnessReport(),
        api.listHarnessStepRuns(),
      ]);
      setCases(caseRes.cases);
      setFixtureDir(caseRes.fixtureDir);
      setReport(scopedReport(reportRes.report, tenant));
      setStepRuns(stepRunRes.runs);
      setStepForm((current) => {
        const firstCase = caseRes.cases[0];
        const defaults = defaultStepForTenant(tenant, firstCase);
        if (current.tenant !== tenant) return defaults;
        return {
          ...current,
          workflowRunId: current.workflowRunId || defaults.workflowRunId,
          stepId: current.stepId || defaults.stepId,
          employeeId: current.employeeId || defaults.employeeId,
          tenant: current.tenant && current.tenant === tenant ? current.tenant : defaults.tenant,
          userId: current.userId || defaults.userId,
          prompt: current.prompt || defaults.prompt,
        };
      });
      const nextReport = scopedReport(reportRes.report, tenant);
      if (!selectedId && nextReport?.results[0]) {
        setSelectedId(nextReport.results[0].case.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载 Harness 失败');
    } finally {
      setLoading(false);
    }
  }

  async function run(caseIds?: string[]) {
    const scopedIds = caseIds ?? cases.map((testCase) => testCase.id);
    if (scopedIds.length === 0) {
      setError('当前企业没有可运行的 Harness 用例');
      return;
    }
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const { report: next } = await api.runHarnessSuite(scopedIds);
      setReport(next);
      setSelectedId(next.results[0]?.case.id ?? null);
      setMessage(`${scopedIds.length === 1 ? '单条用例' : '当前企业用例'}运行完成：${next.summary.passed} passed, ${next.summary.failed} failed`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '运行 Harness 失败');
    } finally {
      setRunning(false);
    }
  }

  async function runStep() {
    if (!stepForm.employeeId.trim()) {
      setError('请填写员工 ID');
      return;
    }
    if (!stepForm.prompt.trim()) {
      setError('请填写 Step Prompt');
      return;
    }
    setRunningStep(true);
    setError(null);
    setMessage(null);
    try {
      const { run: next } = await api.runHarnessStep({
        workflowRunId: stepForm.workflowRunId.trim() || undefined,
        stepId: stepForm.stepId.trim() || undefined,
        employeeId: stepForm.employeeId.trim(),
        tenant: stepForm.tenant.trim() || undefined,
        userId: stepForm.userId.trim() || undefined,
        prompt: stepForm.prompt.trim(),
      });
      setStepRuns((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setMessage(`StepRun ${next.status}: ${next.input.workflowRunId} / ${next.input.stepId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '运行 StepRun 失败');
    } finally {
      setRunningStep(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tenant]);

  return (
    <section className="page-enter" style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.heading}>验收 Harness</h2>
          <p style={s.sub}>{fixtureDir || 'tests/fixtures/harness'} · 当前企业 {tenant} · 用例驱动的回归验证入口，结果以 Trace 报告为准</p>
        </div>
        <div style={s.actions}>
          <button type="button" style={withDisabled(s.iconButton, loading || running || runningStep)} onClick={() => void load()} disabled={loading || running || runningStep} title="刷新">
            <RefreshCw size={16} />
          </button>
          <button type="button" style={withDisabled(s.primaryButton, loading || running || cases.length === 0)} onClick={() => void run()} disabled={loading || running || cases.length === 0}>
            <Play size={16} />
            {running ? '运行中...' : '运行当前企业'}
          </button>
        </div>
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}
      {message && <div style={s.successBanner}>{message}</div>}

      <div style={s.metrics}>
        <div style={s.metric}>
          <span style={s.metricLabel}>Cases</span>
          <strong style={s.metricValue}>{cases.length}</strong>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>Passed</span>
          <strong style={s.metricValue}>{report?.summary.passed ?? 0}</strong>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>Failed</span>
          <strong style={s.metricValue}>{report?.summary.failed ?? 0}</strong>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>Last Run</span>
          <strong style={s.metricTime}>{report ? new Date(report.createdAt).toLocaleString() : '-'}</strong>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>StepRuns</span>
          <strong style={s.metricValue}>{stepRuns.length}</strong>
        </div>
      </div>

      <div style={s.grid}>
        <section style={s.panel}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>验收用例</h3>
            <span style={s.panelMeta}>{loading ? 'loading' : `${cases.length} for ${tenant}`}</span>
          </div>
          <div style={s.caseList}>
            {cases.length === 0 && <div style={s.empty}>当前企业没有 Harness YAML 用例。请切换企业，或先为该企业补充验收 fixture。</div>}
            {cases.map((testCase) => {
              const result = report?.results.find((item) => item.case.id === testCase.id);
              return (
                <article key={testCase.id} style={s.caseRow}>
                  <button
                    type="button"
                    style={s.caseButton}
                    onClick={() => setSelectedId(testCase.id)}
                  >
                    <div style={s.caseTop}>
                      <span style={s.caseTitle}>{testCase.id}</span>
                      <span style={s.status}>
                        {result ? statusIcon(result.status) : <ListChecks size={16} color="#64748b" />}
                      </span>
                    </div>
                    <p style={s.caseDesc}>{shortDescription(testCase.description)}</p>
                    <div style={s.tags}>
                      <span style={s.tag}>{channelLabel(testCase.input.channel)}</span>
                      {testCase.input.tenant && <span style={s.tag}>{testCase.input.tenant}</span>}
                      <span style={s.tag}>{testCase.input.botName}</span>
                      {testCase.expect.routedEmployee && <span style={s.tag}>{testCase.expect.routedEmployee}</span>}
                    </div>
                  </button>
                  <button
                    type="button"
                    style={withDisabled(s.runSmall, running)}
                    onClick={() => void run([testCase.id])}
                    disabled={running}
                    title="运行单条"
                  >
                    <Play size={14} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section style={s.panel}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>Trace 报告</h3>
            <span style={s.panelMeta}>{selected?.status ?? 'empty'}</span>
          </div>
          {!selected ? (
            <div style={s.empty}>暂无报告</div>
          ) : (
            <div style={s.detail}>
              <div style={s.detailHead}>
                <div style={s.detailStatus}>{statusIcon(selected.status)}<strong>{selected.case.id}</strong></div>
                <span style={s.reply}>{selected.ingress?.reply ?? selected.error ?? '-'}</span>
              </div>

              {selected.failures.length > 0 && (
                <div style={s.failures}>
                  {selected.failures.map((failure) => (
                    <div key={failure.expectation} style={s.failureRow}>
                      <strong>{failure.expectation}</strong>
                      <span>{JSON.stringify(failure.actual)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={s.traceGrid}>
                <div style={s.traceBox}>
                  <span style={s.traceLabel}>Routing</span>
                  <strong>{selected.ingress?.trace.routing.selectedEmployee ?? '-'}</strong>
                  <span>{selected.ingress?.trace.routing.mode ?? 'direct'}</span>
                </div>
                <div style={s.traceBox}>
                  <span style={s.traceLabel}>Tools</span>
                  <strong>{selected.ingress?.trace.toolCalls.length ?? 0}</strong>
                  <span>{selected.ingress?.trace.toolCalls.map((tool) => tool.name).join(', ') || '-'}</span>
                </div>
                <div style={s.traceBox}>
                  <span style={s.traceLabel}>Memory</span>
                  <strong>{selected.ingress?.trace.memory.length ?? 0}</strong>
                  <span>{selected.ingress?.trace.memory.map((m) => `${m.operation}:${m.subject}`).join(', ') || '-'}</span>
                </div>
                <div style={s.traceBox}>
                  <span style={s.traceLabel}>Handoffs</span>
                  <strong>{selected.ingress?.trace.handoffs.length ?? 0}</strong>
                  <span>{selected.ingress?.trace.handoffs.map((h) => `${h.from}->${h.to}`).join(', ') || '-'}</span>
                </div>
                <div style={s.traceBox}>
                  <span style={s.traceLabel}>Artifacts</span>
                  <strong>{selected.ingress?.trace.businessArtifacts.length ?? 0}</strong>
                  <span>{selected.ingress?.trace.businessArtifacts.map((a) => `${a.status}:${a.type}${a.id ? `:${a.id}` : ''}`).join(', ') || '-'}</span>
                </div>
              </div>

              <pre style={s.pre}>{JSON.stringify(selected.ingress?.trace ?? { error: selected.error }, null, 2)}</pre>
            </div>
          )}
        </section>
      </div>

      <section style={s.panel}>
        <div style={s.panelHeader}>
          <h3 style={s.panelTitle}>长任务 StepRun</h3>
          <span style={s.panelMeta}>{stepRuns.length} total</span>
        </div>
        <div style={s.stepForm}>
          <label style={s.label}>
            编排 Run
            <input
              style={s.input}
              value={stepForm.workflowRunId}
              onChange={(event) => setStepForm((current) => ({ ...current, workflowRunId: event.target.value }))}
            />
          </label>
          <label style={s.label}>
            Step
            <input
              style={s.input}
              value={stepForm.stepId}
              onChange={(event) => setStepForm((current) => ({ ...current, stepId: event.target.value }))}
            />
          </label>
          <label style={s.label}>
            员工 ID
            <input
              style={s.input}
              value={stepForm.employeeId}
              onChange={(event) => setStepForm((current) => ({ ...current, employeeId: event.target.value }))}
              placeholder="sales-zhangsan"
            />
          </label>
          <label style={s.label}>
            租户
            <input
              style={s.input}
              value={stepForm.tenant}
              onChange={(event) => setStepForm((current) => ({ ...current, tenant: event.target.value }))}
              placeholder="acme"
            />
          </label>
          <label style={{ ...s.label, ...s.stepPrompt }}>
            Step Prompt
            <textarea
              style={s.textarea}
              value={stepForm.prompt}
              onChange={(event) => setStepForm((current) => ({ ...current, prompt: event.target.value }))}
            />
          </label>
          <button type="button" style={withDisabled(s.primaryButton, loading || runningStep)} onClick={() => void runStep()} disabled={loading || runningStep}>
            <Play size={16} />
            {runningStep ? '执行中...' : '运行 Step'}
          </button>
        </div>
        {stepRuns.length === 0 ? (
          <div style={s.empty}>暂无 StepRun。可以在上方直接通过真实 MessageIngressRuntime 创建运行态。</div>
        ) : (
          <div style={s.stepRunList}>
            {stepRuns.map((run) => (
              <article key={run.id} style={s.stepRunRow}>
                <strong>{run.input.workflowRunId} / {run.input.stepId}</strong>
                <span>{run.input.employeeId}</span>
                <span>{run.status}{run.failureClass ? ` · ${run.failureClass}` : ''}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function withDisabled(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.45, cursor: 'not-allowed' } : style;
}

const s: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  heading: { margin: 0, fontSize: 'var(--text-hero)', fontWeight: 400, fontFamily: 'var(--font-display)', letterSpacing: 'var(--tracking-tight)', color: 'var(--color-text-primary)' },
  sub: { margin: '8px 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-lg)' },
  actions: { display: 'flex', gap: 8, alignItems: 'center' },
  iconButton: { width: 36, height: 36, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  primaryButton: { height: 36, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 14px', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  errorBanner: { padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-danger-dim)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', fontSize: 'var(--text-base)' },
  successBanner: { padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-success-dim)', color: 'var(--color-success)', border: '1px solid var(--color-success)', fontSize: 'var(--text-base)' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 },
  metric: { padding: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, boxShadow: 'var(--shadow-card)' },
  metricLabel: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' },
  metricValue: { fontSize: 'var(--text-2xl)', color: 'var(--color-text-primary)', fontWeight: 400 },
  metricTime: { fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(420px, 1.1fr)', gap: 16, alignItems: 'start' },
  panel: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' },
  panelHeader: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { margin: 0, fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--color-text-primary)' },
  panelMeta: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1px' },
  caseList: { display: 'flex', flexDirection: 'column' },
  caseRow: { display: 'grid', gridTemplateColumns: '1fr 40px', borderBottom: '1px solid var(--color-border)' },
  caseButton: { textAlign: 'left', border: 0, background: 'transparent', padding: 14, cursor: 'pointer', minWidth: 0 },
  caseTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  caseTitle: { fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', overflowWrap: 'anywhere' },
  status: { display: 'inline-flex', flexShrink: 0 },
  caseDesc: { margin: '6px 0 0', color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.45 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { fontSize: 'var(--text-xs)', padding: '3px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-raised)', color: 'var(--color-text-secondary)' },
  runSmall: { border: 0, borderLeft: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  empty: { padding: 20, color: 'var(--color-text-secondary)', fontSize: 13 },
  detail: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  detailHead: { display: 'flex', flexDirection: 'column', gap: 8 },
  detailStatus: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)', fontSize: 14 },
  reply: { color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.5 },
  failures: { display: 'flex', flexDirection: 'column', gap: 8 },
  failureRow: { padding: 10, borderRadius: 6, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 },
  traceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  traceBox: { padding: 12, border: '1px solid var(--color-border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  traceLabel: { fontSize: 11, color: 'var(--color-text-secondary)' },
  pre: { margin: 0, padding: 12, borderRadius: 6, background: 'var(--color-bg-raised)', color: 'var(--color-text-primary)', overflow: 'auto', maxHeight: 360, fontSize: 12, lineHeight: 1.5 },
  stepRunList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, padding: 16 },
  stepRunRow: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--color-text-primary)', fontSize: 12 },
  stepForm: { padding: 16, borderBottom: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end', background: 'var(--color-bg-raised)' },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' },
  input: { height: 36, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: '0 10px', fontSize: 'var(--text-base)', minWidth: 0 },
  textarea: { minHeight: 72, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: 10, fontSize: 'var(--text-base)', lineHeight: 1.5, resize: 'vertical' },
  stepPrompt: { gridColumn: '1 / -1' },
};
