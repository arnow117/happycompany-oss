import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, Clock3, FileText, GitBranch, MessageSquareText, Route, Search, Wrench } from 'lucide-react';
import { api, type WorkflowCase, type WorkflowTimelineEvent } from '../lib/api';
import { useChatStore } from '../stores/chat';

function formatTime(value: number): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function stateLabel(state: WorkflowCase['state']): string {
  if (state === 'failed') return '异常';
  if (state === 'archived') return '已归档';
  if (state === 'completed') return '完成';
  return '进行中';
}

function eventTitle(event: WorkflowTimelineEvent): string {
  if (event.type === 'user_message') return '用户消息';
  if (event.type === 'agent_message') return event.employeeId ? `${event.employeeId} 回复` : '数字员工回复';
  if (event.type === 'routing_decision') return '路由决策';
  if (event.type === 'tool_call') return event.toolName ? `工具 ${event.toolName}` : '工具调用';
  if (event.type === 'handoff') return '员工协同';
  if (event.type === 'memory') return '记忆操作';
  if (event.type === 'business_artifact') return '业务产物';
  return '异常';
}

function eventIcon(event: WorkflowTimelineEvent) {
  if (event.type === 'user_message') return <MessageSquareText size={15} />;
  if (event.type === 'agent_message') return <Bot size={15} />;
  if (event.type === 'routing_decision') return <Route size={15} />;
  if (event.type === 'tool_call') return <Wrench size={15} />;
  if (event.type === 'handoff') return <GitBranch size={15} />;
  if (event.type === 'business_artifact') return <FileText size={15} />;
  if (event.type === 'error') return <AlertTriangle size={15} />;
  return <Clock3 size={15} />;
}

function eventBody(event: WorkflowTimelineEvent): string {
  if (event.type === 'handoff') {
    const route = [event.fromEmployeeId, event.toEmployeeId].filter(Boolean).join(' -> ');
    return [route, event.reason].filter(Boolean).join(' · ');
  }
  if (event.type === 'tool_call') {
    return [event.status, event.toolName].filter(Boolean).join(' · ');
  }
  if (event.type === 'routing_decision') {
    const selected = typeof event.payload?.selectedEmployee === 'string' ? event.payload.selectedEmployee : event.employeeId;
    const bound = typeof event.payload?.boundEmployee === 'string' ? event.payload.boundEmployee : undefined;
    return [selected ? `选中 ${selected}` : undefined, bound ? `绑定 ${bound}` : undefined].filter(Boolean).join(' · ');
  }
  if (event.type === 'memory') {
    const operation = typeof event.payload?.operation === 'string' ? event.payload.operation : undefined;
    const subject = typeof event.payload?.subject === 'string' ? event.payload.subject : undefined;
    return [operation, subject, event.status].filter(Boolean).join(' · ');
  }
  if (event.type === 'business_artifact') {
    return [event.status, event.artifactType, event.artifactId].filter(Boolean).join(' · ');
  }
  if (event.type === 'error') {
    return [event.stage, event.message].filter(Boolean).join(' · ');
  }
  return event.text ?? '';
}

function hasCaseText(item: WorkflowCase, query: string): boolean {
  const text = [
    item.preview,
    item.actorId,
    item.entryId,
    item.currentEmployeeId,
    ...item.participants,
  ].join(' ').toLowerCase();
  return text.includes(query.toLowerCase());
}

export function Orchestration() {
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const tenants = useChatStore((state) => state.tenants);
  const tenant = selectedTenant || tenants[0]?.id || 'acme-happycompany';
  const [cases, setCases] = useState<WorkflowCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [timeline, setTimeline] = useState<WorkflowTimelineEvent[]>([]);
  const [query, setQuery] = useState('');
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCases(true);
    setError(null);
    api.listRuntimeCases({ tenant, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setCases(res.cases);
        setSelectedCaseId((current) => (
          res.cases.some((item) => item.id === current) ? current : res.cases[0]?.id ?? ''
        ));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载协同日志失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingCases(false);
      });
    return () => { cancelled = true; };
  }, [tenant]);

  const filteredCases = useMemo(
    () => cases.filter((item) => !query.trim() || hasCaseText(item, query.trim())),
    [cases, query],
  );
  const selectedCase = filteredCases.find((item) => item.id === selectedCaseId) ?? filteredCases[0] ?? null;
  const totalHandoffs = cases.reduce((sum, item) => sum + item.handoffCount, 0);

  useEffect(() => {
    if (!selectedCase) {
      setTimeline([]);
      return;
    }
    let cancelled = false;
    setLoadingTimeline(true);
    setError(null);
    api.getRuntimeCaseTimeline(selectedCase.id)
      .then((res) => {
        if (!cancelled) setTimeline(res.timeline);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载协同时间线失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingTimeline(false);
      });
    return () => { cancelled = true; };
  }, [selectedCase]);

  return (
    <section>
      <div style={s.header}>
        <div>
          <h2 style={s.heading}>协同日志</h2>
          <p style={s.sub}>Runtime 对话背后的路由、工具调用和员工 handoff 轨迹</p>
        </div>
        <div style={s.summary}>
          <span style={s.summaryItem}>{cases.length} 事项</span>
          <span style={s.summaryItem}>{totalHandoffs} handoff</span>
        </div>
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}

      <section style={s.toolbar}>
        <label style={s.searchLabel}>
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索员工、入口或消息"
            style={s.searchInput}
          />
        </label>
      </section>

      <div style={s.layout}>
        <section style={s.caseList}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>事项</h3>
            <span style={s.panelMeta}>{filteredCases.length}</span>
          </div>
          {loadingCases ? (
            <div style={s.empty}>加载中...</div>
          ) : filteredCases.length === 0 ? (
            <div style={s.empty}>暂无协同记录</div>
          ) : (
            <div style={s.caseStack}>
              {filteredCases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  style={{ ...s.caseButton, ...(selectedCase?.id === item.id ? s.caseButtonActive : {}) }}
                  onClick={() => setSelectedCaseId(item.id)}
                >
                  <div style={s.caseTop}>
                    <strong style={s.caseTitle}>{item.preview || item.title || item.id}</strong>
                    <span style={item.state === 'failed' ? s.badgeDanger : s.badge}>{stateLabel(item.state)}</span>
                  </div>
                  <div style={s.caseMeta}>{item.actorId} · {item.entryId}</div>
                  <div style={s.caseFooter}>
                    <span>{item.currentEmployeeId}</span>
                    <span>{item.handoffCount} handoff</span>
                    <span>{formatTime(item.lastMessageAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={s.timelinePanel}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>时间线</h3>
            {selectedCase && <span style={s.panelMeta}>{selectedCase.participants.length} employees</span>}
          </div>
          {!selectedCase ? (
            <div style={s.empty}>选择一个协同事项查看轨迹</div>
          ) : (
            <>
              <div style={s.caseContext}>
                <div>
                  <div style={s.contextLabel}>当前负责人</div>
                  <strong style={s.contextValue}>{selectedCase.currentEmployeeId}</strong>
                </div>
                <div>
                  <div style={s.contextLabel}>参与员工</div>
                  <div style={s.participants}>
                    {selectedCase.participants.map((employee) => (
                      <span key={employee} style={s.participantChip}>{employee}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={s.contextLabel}>会话</div>
                  <div style={s.mono}>{selectedCase.chatId}</div>
                </div>
              </div>

              {loadingTimeline ? (
                <div style={s.empty}>加载中...</div>
              ) : timeline.length === 0 ? (
                <div style={s.empty}>暂无时间线事件</div>
              ) : (
                <ol style={s.timeline}>
                  {timeline.map((event) => (
                    <li key={event.id} style={s.timelineItem}>
                      <div style={s.timelineIcon}>{eventIcon(event)}</div>
                      <div style={s.timelineBody}>
                        <div style={s.timelineTop}>
                          <strong style={s.eventTitle}>{eventTitle(event)}</strong>
                          <span style={s.eventTime}>{formatTime(event.at)}</span>
                        </div>
                        {event.type === 'handoff' && (
                          <div style={s.handoffRoute}>
                            <span>{event.fromEmployeeId ?? '-'}</span>
                            <ArrowRight size={13} />
                            <span>{event.toEmployeeId ?? '-'}</span>
                          </div>
                        )}
                        {eventBody(event) && <p style={s.eventBody}>{eventBody(event)}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

const s = {
  header: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', alignItems: 'flex-start' } as React.CSSProperties,
  heading: { fontSize: 'var(--text-hero)', fontWeight: 400, fontFamily: 'var(--font-display)', letterSpacing: 'var(--tracking-tight)', margin: 0, color: 'var(--color-text-primary)' } as React.CSSProperties,
  sub: { fontSize: 'var(--text-lg)', color: 'var(--color-text-muted)', margin: '8px 0 0' } as React.CSSProperties,
  summary: { display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' } as React.CSSProperties,
  summaryItem: { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', background: 'var(--color-bg-base)' } as React.CSSProperties,
  errorBanner: { marginTop: 'var(--space-md)', padding: '12px 20px', background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: 'var(--text-base)' } as React.CSSProperties,
  toolbar: { marginTop: 'var(--space-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' } as React.CSSProperties,
  searchLabel: { minWidth: 260, maxWidth: 420, flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: 8, height: 38, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0 10px', background: 'var(--color-bg-input)', color: 'var(--color-text-muted)' } as React.CSSProperties,
  searchInput: { border: 0, outline: 0, background: 'transparent', color: 'var(--color-text-primary)', width: '100%', fontSize: 'var(--text-sm)' } as React.CSSProperties,
  layout: { marginTop: 'var(--space-md)', display: 'grid', gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(420px, 1.35fr)', gap: 'var(--space-md)', alignItems: 'start' } as React.CSSProperties,
  caseList: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-base)', padding: 'var(--space-md)', minWidth: 0 } as React.CSSProperties,
  timelinePanel: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-base)', padding: 'var(--space-md)', minWidth: 0 } as React.CSSProperties,
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' } as React.CSSProperties,
  panelTitle: { margin: 0, fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--color-text-primary)' } as React.CSSProperties,
  panelMeta: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1px' } as React.CSSProperties,
  empty: { padding: 'var(--space-lg)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' } as React.CSSProperties,
  caseStack: { display: 'flex', flexDirection: 'column', gap: 8 } as React.CSSProperties,
  caseButton: { border: '1px solid var(--color-border-soft)', borderRadius: 'var(--radius-md)', background: 'transparent', padding: 12, display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left', cursor: 'pointer', minWidth: 0 } as React.CSSProperties,
  caseButtonActive: { background: 'var(--color-bg-raised)', borderColor: 'var(--color-accent)' } as React.CSSProperties,
  caseTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' } as React.CSSProperties,
  caseTitle: { color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)', lineHeight: 1.4, overflowWrap: 'anywhere' } as React.CSSProperties,
  caseMeta: { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' } as React.CSSProperties,
  caseFooter: { display: 'flex', flexWrap: 'wrap', gap: 8, color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' } as React.CSSProperties,
  badge: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-success)', background: 'rgba(74, 222, 128, 0.12)', borderRadius: 'var(--radius-sm)', padding: '2px 7px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' } as React.CSSProperties,
  badgeDanger: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-danger)', background: 'var(--color-danger-dim)', borderRadius: 'var(--radius-sm)', padding: '2px 7px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' } as React.CSSProperties,
  caseContext: { display: 'grid', gridTemplateColumns: 'minmax(140px, 0.7fr) minmax(180px, 1.1fr) minmax(180px, 1fr)', gap: 'var(--space-sm)', padding: 'var(--space-sm)', border: '1px solid var(--color-border-soft)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-raised)', marginBottom: 'var(--space-md)' } as React.CSSProperties,
  contextLabel: { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginBottom: 4 } as React.CSSProperties,
  contextValue: { color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)', overflowWrap: 'anywhere' } as React.CSSProperties,
  participants: { display: 'flex', flexWrap: 'wrap', gap: 6 } as React.CSSProperties,
  participantChip: { border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)', padding: '3px 7px', fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' } as React.CSSProperties,
  mono: { color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' } as React.CSSProperties,
  timeline: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 } as React.CSSProperties,
  timelineItem: { display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: 10 } as React.CSSProperties,
  timelineIcon: { width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '999px', background: 'var(--color-accent-dim)', color: 'var(--color-accent)' } as React.CSSProperties,
  timelineBody: { minWidth: 0, border: '1px solid var(--color-border-soft)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'transparent' } as React.CSSProperties,
  timelineTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } as React.CSSProperties,
  eventTitle: { color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' } as React.CSSProperties,
  eventTime: { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' } as React.CSSProperties,
  handoffRoute: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', overflowWrap: 'anywhere' } as React.CSSProperties,
  eventBody: { margin: '7px 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as React.CSSProperties,
};
