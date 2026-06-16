import { Fragment, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { RuntimeActor, RuntimeEntry, RuntimeMessage, RuntimeSessionInfo } from '../lib/api';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

const SESSION_PAGE_SIZE_OPTIONS = [10, 50, 100] as const;
const DEFAULT_SESSION_PAGE_SIZE = 50;

type SessionPageSize = typeof SESSION_PAGE_SIZE_OPTIONS[number];

export function Sessions() {
  const [selectedTenant, setSelectedTenant] = useState('');
  const [tenants, setTenants] = useState<Array<{ id: string; displayName: string }>>([]);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [entries, setEntries] = useState<RuntimeEntry[]>([]);
  const [selectedActorId, setSelectedActorId] = useState('');
  const [actors, setActors] = useState<RuntimeActor[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearedId, setClearedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<SessionPageSize>(DEFAULT_SESSION_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  // Expanded chat view
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RuntimeMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  useEffect(() => {
    api.listTenants()
      .then((res) => {
        setTenants(res.tenants);
        setSelectedTenant((current) => {
          const next = res.tenants.some((tenant) => tenant.id === current)
            ? current
            : res.tenants.find((tenant) => tenant.id === 'acme-happycompany')?.id || res.tenants[0]?.id || '';
          if (next !== current) setCurrentPage(0);
          return next;
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load tenants'),
      );
  }, []);

  useEffect(() => {
    if (!selectedTenant) {
      setEntries([]);
      setActors([]);
      return;
    }
    setEntries([]);
    setActors([]);
    setSelectedEntryId('');
    setSelectedActorId('');
    setCurrentPage(0);
    api.listRuntimeEntries(selectedTenant)
      .then(({ entries: list }) => {
        setEntries(list);
        setSelectedEntryId((current) =>
          list.some((entry) => entry.id === current)
            ? current
            : '',
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load entries'),
      );
  }, [selectedTenant]);

  useEffect(() => {
    if (!selectedTenant) {
      setActors([]);
      return;
    }
    setActors([]);
    api.listRuntimeActors(selectedTenant, selectedEntryId || undefined)
      .then(({ actors: list }) => {
        setActors(list);
        setSelectedActorId((current) =>
          list.some((actor) => actor.actorId === current) ? current : '',
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load actors'),
      );
  }, [selectedTenant, selectedEntryId]);

  useEffect(() => {
    if (!selectedTenant) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const filter: RuntimeSessionPageFilter = { tenant: selectedTenant };
    if (selectedEntryId) filter.entryId = selectedEntryId;
    if (selectedActorId) filter.actorId = selectedActorId;
    api.listRuntimeSessions({
      ...filter,
      limit: pageSize + 1,
      offset: currentPage * pageSize,
    })
      .then(({ sessions: list }) => {
        if (cancelled) return;
        setSessions(list.slice(0, pageSize));
        setHasNextPage(list.length > pageSize);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTenant, selectedEntryId, selectedActorId, pageSize, currentPage, clearedId]);

  const handleToggleExpand = (chatId: string) => {
    if (expandedChatId === chatId) {
      setExpandedChatId(null);
      setMessages([]);
      return;
    }
    setExpandedChatId(chatId);
    setMsgLoading(true);
    api.getRuntimeSessionMessages(chatId, 100)
      .then((d) => setMessages(d.messages))
      .catch(() => setError('Failed to load messages'))
      .finally(() => setMsgLoading(false));
  };

  const handleClear = (sessionId: string) => {
    setClearedId(sessionId);
    api.archiveRuntimeSession(sessionId)
      .then(() => {
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        if (expandedChatId === sessionId) {
          setExpandedChatId(null);
          setMessages([]);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to archive session'),
      )
      .finally(() => setClearedId(null));
  };

  return (
    <section>
      <h2 style={heading}>Sessions</h2>
      <p style={subtitle}>Manage Claude sessions and view conversation history.</p>

      {error && <div style={errorBanner}>{error}</div>}

      <div style={selectorRow}>
        <label style={selectorLabel}>Tenant</label>
        <select style={selector} value={selectedTenant} onChange={(e) => {
          setSelectedTenant(e.target.value);
          setCurrentPage(0);
        }}>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>{tenant.displayName || tenant.id}</option>
          ))}
        </select>
        <label style={selectorLabel}>Entry</label>
        <select style={selector} value={selectedEntryId} onChange={(e) => {
          setSelectedEntryId(e.target.value);
          setCurrentPage(0);
        }}>
          <option value="">全部入口</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.displayName || entry.id}</option>
          ))}
        </select>
        <label style={selectorLabel}>Actor</label>
        <select style={selector} value={selectedActorId} onChange={(e) => {
          setSelectedActorId(e.target.value);
          setCurrentPage(0);
        }}>
          <option value="">全部人员</option>
          {actors.map((actor) => (
            <option key={actor.actorId} value={actor.actorId}>{actor.displayName || actor.actorId}</option>
          ))}
        </select>
        <label style={selectorLabel}>Rows</label>
        <select style={selector} value={pageSize} onChange={(e) => {
          setPageSize(Number(e.target.value) as SessionPageSize);
          setCurrentPage(0);
        }}>
          {SESSION_PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>

      {loading && <LoadingSkeleton type="table-row" count={5} />}

      {!loading && sessions.length === 0 && (
        <div style={emptyState}>No sessions found.</div>
      )}

      {!loading && sessions.length > 0 && (
        <>
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Chat ID</th>
                  <th style={th}>Messages</th>
                  <th style={th}>Preview</th>
                  <th style={thAction}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <Fragment key={s.id}>
                  <tr
                    onClick={() => handleToggleExpand(s.id)}
                    style={{
                      ...tr,
                      cursor: 'pointer',
                      background: expandedChatId === s.id ? 'var(--color-bg-overlay)' : undefined,
                    }}
                  >
                    <td style={td}>
                      <code style={chatIdCode}>{s.chatId}</code>
                      <div style={mutedText}>{s.entryId} · {s.actorId} · {s.employeeId}</div>
                    </td>
                    <td style={tdCount}>{s.messageCount}</td>
                    <td style={tdPreview}>{s.preview || '-'}</td>
                    <td style={tdAction}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Link
                          to={runtimeChatPath(s)}
                          style={chatLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Chat
                        </Link>
                        {clearedId === s.id ? (
                          <span style={feedbackText}>Archiving</span>
                        ) : (
                          <button style={clearBtn} onClick={(e) => { e.stopPropagation(); handleClear(s.id); }}>
                            Clear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedChatId === s.id && (
                    <tr>
                      <td colSpan={4} style={detailTd}>
                        {msgLoading ? (
                          <LoadingSkeleton type="text-line" count={3} />
                        ) : messages.length === 0 ? (
                          <div style={mutedText}>No messages in this chat.</div>
                        ) : (
                          <div style={msgList}>
                            {messages.map((m) => (
                              <div key={m.id} style={msgBubble(m.source)}>
                                <div style={msgMeta}>
                                  <span style={msgSource}>{m.source}</span>
                                  <span style={msgTime}>{new Date(m.timestamp).toLocaleString()}</span>
                                </div>
                                <div style={msgText}>{m.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div style={pagerRow}>
            <button
              type="button"
              style={pagerButton(currentPage === 0)}
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
            >
              Previous
            </button>
            <span style={pagerText}>Page {currentPage + 1}</span>
            <button
              type="button"
              style={pagerButton(!hasNextPage)}
              disabled={!hasNextPage}
              onClick={() => setCurrentPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}

interface RuntimeSessionPageFilter {
  tenant: string;
  entryId?: string;
  actorId?: string;
}

function runtimeChatPath(session: RuntimeSessionInfo): string {
  const params = new URLSearchParams({
    tenant: session.tenant,
    entry: session.entryId,
    actor: session.actorId,
    employee: session.employeeId,
    session: session.id,
    chat: session.chatId,
  });
  return `/chat?${params.toString()}`;
}

const heading: React.CSSProperties = {
  fontSize: '36px', fontWeight: 400, fontFamily: 'var(--font-display)',
  letterSpacing: '-0.5px', margin: 0, color: 'var(--color-text-primary)',
};

const subtitle: React.CSSProperties = {
  fontSize: '16px', color: 'var(--color-text-muted)', margin: '8px 0 0',
};

const errorBanner: React.CSSProperties = {
  marginTop: 'var(--space-md)', padding: '12px 20px',
  background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: '14px',
};

const loadingState: React.CSSProperties = {
  padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)',
};

const emptyState: React.CSSProperties = {
  marginTop: 'var(--space-xl)', padding: '32px', textAlign: 'center',
  color: 'var(--color-text-muted)', fontSize: '14px',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const selectorRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
  marginTop: 'var(--space-lg)',
};

const selectorLabel: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted)',
  textTransform: 'uppercase', letterSpacing: '1.5px',
};

const selector: React.CSSProperties = {
  padding: '6px 12px', fontSize: '14px',
  fontFamily: 'var(--font-body)', color: 'var(--color-text-primary)',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

const pagerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px',
  marginTop: 'var(--space-md)',
};

const pagerButton = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px', fontSize: '12px', fontWeight: 500,
  color: disabled ? 'var(--color-text-muted-soft)' : 'var(--color-text-secondary)',
  background: disabled ? 'var(--color-bg-deep)' : 'var(--color-bg-base)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)',
});

const pagerText: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)',
};

const tableWrap: React.CSSProperties = {
  marginTop: 'var(--space-lg)', background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
};

const table: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse',
};

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 20px', fontSize: '12px',
  fontWeight: 500, color: 'var(--color-text-muted)',
  textTransform: 'uppercase', letterSpacing: '1.5px',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-deep)',
};

const thAction: React.CSSProperties = {
  ...th, textAlign: 'right',
};

const tr: React.CSSProperties = {
  transition: 'background 150ms',
};

const td: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid var(--color-border)',
  fontSize: '13px', color: 'var(--color-text-secondary)',
  maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const tdCount: React.CSSProperties = {
  ...td, textAlign: 'center', width: '80px',
};

const tdPreview: React.CSSProperties = {
  ...td, maxWidth: '400px',
};

const tdAction: React.CSSProperties = {
  ...td, textAlign: 'right',
};

const chatIdCode: React.CSSProperties = {
  fontSize: '13px', fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-secondary)',
  wordBreak: 'break-all',
};

const clearBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: '11px', fontWeight: 500,
  color: 'var(--color-danger)', background: 'var(--color-danger-dim)',
  border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-pill)',
  cursor: 'pointer', fontFamily: 'var(--font-body)',
  textTransform: 'uppercase', letterSpacing: '1px',
};

const chatLink: React.CSSProperties = {
  padding: '3px 10px', fontSize: '11px', fontWeight: 500,
  color: 'var(--color-accent)', background: 'var(--color-accent-dim)',
  border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-pill)',
  textDecoration: 'none', fontFamily: 'var(--font-body)',
  textTransform: 'uppercase', letterSpacing: '1px',
  cursor: 'pointer',
};

const feedbackText: React.CSSProperties = {
  fontSize: '12px', color: 'var(--color-success)', fontFamily: 'var(--font-mono)',
};

const detailTd: React.CSSProperties = {
  padding: 0, borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-deep)',
};

const mutedText: React.CSSProperties = {
  color: 'var(--color-text-muted)', fontSize: '13px', padding: '16px 20px',
};

const msgList: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 0',
  maxHeight: '400px', overflowY: 'auto',
};

const msgBubble = (source: string): React.CSSProperties => ({
  padding: '8px 20px',
  borderLeft: source === 'user'
    ? '3px solid var(--color-accent)'
    : '3px solid var(--color-success)',
  marginLeft: '8px',
});

const msgMeta: React.CSSProperties = {
  display: 'flex', gap: '10px', alignItems: 'baseline', marginBottom: '2px',
};

const msgSource: React.CSSProperties = {
  fontSize: '11px', fontWeight: 500, textTransform: 'uppercase',
  color: 'var(--color-text-muted)', letterSpacing: '1px',
};

const msgTime: React.CSSProperties = {
  fontSize: '11px', color: 'var(--color-text-muted-soft)',
};

const msgText: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-secondary)',
  lineHeight: '1.55', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
