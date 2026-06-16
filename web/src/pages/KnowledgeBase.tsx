import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { BotInfo } from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface KnowledgeFile {
  name: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBase() {
  const [selectedBot, setSelectedBot] = useState('');
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [knowledgePath, setKnowledgePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

  // Three-tier knowledge state
  const [tierCards, setTierCards] = useState<Array<{ name: string; tier: string; tierId: string; size: number; updatedAt: string }>>([]);
  const [tierLoading, setTierLoading] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierTab, setTierTab] = useState<'all' | 'company' | 'group' | 'employee'>('all');

  const selectedBotInfo = bots.find((b) => b.name === selectedBot);
  const tenantName = selectedBotInfo?.tenant ?? selectedBotInfo?.workdir.match(/(?:^|[\\/])corp[\\/](.+?)(?:[\\/]|$)/)?.[1] ?? 'acme';

  useEffect(() => {
    api.health()
      .then((h) => {
        setBots(h.bots);
        if (h.bots.length > 0 && !selectedBot) {
          setSelectedBot(h.bots[0].name);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load bots'),
      );
  }, []);

  useEffect(() => {
    if (!selectedBot) return;
    setLoading(true);
    setError(null);
    api.listKnowledgeFiles(selectedBot)
      .then((res) => {
        setFiles(res.files);
        setKnowledgePath(res.path);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load knowledge files'),
      )
      .finally(() => setLoading(false));
  }, [selectedBot, deletedName]);

  // Fetch three-tier knowledge cards
  useEffect(() => {
    if (!tenantName) return;
    setTierLoading(true);
    setTierError(null);
    api.listKnowledgeCards({ tenant: tenantName, employee: selectedBot })
      .then((res) => setTierCards(res.cards))
      .catch((err: unknown) =>
        setTierError(err instanceof Error ? err.message : 'Failed to load knowledge'),
      )
      .finally(() => setTierLoading(false));
  }, [tenantName, selectedBot]);

  const handleDeleteClick = (filename: string) => {
    setFileToDelete(filename);
    setConfirmOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!fileToDelete) return;
    setConfirmOpen(false);
    api.deleteKnowledgeFile(selectedBot, fileToDelete)
      .then(() => {
        setDeletedName(fileToDelete);
        setFileToDelete(null);
        setTimeout(() => setDeletedName(null), 2000);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Delete failed'),
      );
  };

  return (
    <section>
      <h2 style={heading}>Knowledge Base</h2>
      <p style={subtitle}>Browse and manage knowledge files per bot workdir.</p>

      {error && <div style={errorBanner}>{error}</div>}

      <div style={selectorRow}>
        <label style={selectorLabel}>Bot</label>
        <select
          style={selector}
          value={selectedBot}
          onChange={(e) => setSelectedBot(e.target.value)}
        >
          {bots.map((b) => (
            <option key={b.name} value={b.name}>{b.displayName || b.name}</option>
          ))}
        </select>
        {knowledgePath && <span style={pathLabel}>{knowledgePath}</span>}
      </div>

      {loading && <div style={loadingState}>Loading files...</div>}

      {!loading && files.length === 0 && (
        <div style={emptyState}>
          No knowledge files found.
          <div style={usageHint}>
            Send messages to the bot to create knowledge cards:
            <code style={usageCode}>入库：&lt;内容&gt;</code>
            <code style={usageCode}>查询：&lt;问题&gt;</code>
            <code style={usageCode}>列出知识</code>
          </div>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>File</th>
                <th style={thSize}>Size</th>
                <th style={thAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td style={td}>
                    <code style={fileName}>{f.name}</code>
                  </td>
                  <td style={tdSize}>{formatSize(f.size)}</td>
                  <td style={tdAction}>
                    {deletedName === f.name ? (
                      <span style={feedbackText}>Deleted</span>
                    ) : (
                      <button style={deleteBtn} onClick={() => handleDeleteClick(f.name)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Knowledge File"
        message={fileToDelete ? `Are you sure you want to delete "${fileToDelete}"? This action cannot be undone.` : 'Are you sure you want to delete this file?'}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setConfirmOpen(false);
          setFileToDelete(null);
        }}
        variant="danger"
      />

      {files.length > 0 && (
        <div style={usageCard}>
          <h3 style={usageTitle}>Usage</h3>
          <p style={usageDesc}>Interact with the bot via messaging to manage knowledge:</p>
          <div style={usageList}>
            <div style={usageItem}><code style={usageCode}>入库：&lt;content&gt;</code> Store content as a knowledge card</div>
            <div style={usageItem}><code style={usageCode}>查询：&lt;question&gt;</code> Search and answer from knowledge base</div>
            <div style={usageItem}><code style={usageCode}>列出知识</code> List all knowledge cards</div>
            <div style={usageItem}><code style={usageCode}>删除知识：&lt;title&gt;</code> Remove a specific card</div>
          </div>
        </div>
      )}

      {/* Three-tier knowledge section */}
      <div style={tierSection}>
        <div style={tierHead}>
          <h3 style={tierTitle}>三层知识库</h3>
          <span style={tierTenant}>企业: {tenantName}</span>
        </div>

        <div style={tierTabs}>
          {(['all', 'company', 'group', 'employee'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTierTab(t)}
              style={tierTab === t ? tabActive : tabInactive}
            >
              {t === 'all' ? '全部' : t === 'company' ? '企业' : t === 'group' ? '组织' : '个人'}
            </button>
          ))}
        </div>

        {tierLoading && <div style={{ padding: '16px', color: 'var(--color-text-muted)', fontSize: '14px' }}>Loading...</div>}
        {tierError && <div style={errorBanner}>{tierError}</div>}
        {!tierLoading && !tierError && tierCards.length === 0 && (
          <div style={{ padding: '16px', color: 'var(--color-text-muted)', fontSize: '14px' }}>
            暂无知识卡片。向数字员工发送"入库：内容"消息即可创建。
          </div>
        )}
        {!tierLoading && tierCards.length > 0 && (
          <div style={tierGrid}>
            {tierCards
              .filter((c) => tierTab === 'all' || c.tier === tierTab)
              .map((c) => (
                <div key={`${c.tier}/${c.tierId}/${c.name}`} style={tierCard}>
                  <div style={tierCardHead}>
                    <span style={tierCardName}>{c.name}</span>
                    <span style={{ ...tierBadge, ...tierBadgeColor(c.tier) }}>
                      {c.tier === 'company' ? '企业' : c.tier === 'group' ? '组织' : '个人'}
                    </span>
                  </div>
                  <div style={tierCardMeta}>
                    {new Date(c.updatedAt).toLocaleDateString()} · {formatSize(c.size)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
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
  marginTop: 'var(--space-lg)', padding: '32px', textAlign: 'center',
  color: 'var(--color-text-muted)', fontSize: '14px',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const usageHint: React.CSSProperties = {
  marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px',
  alignItems: 'center',
};

const usageCode: React.CSSProperties = {
  fontSize: '12px', fontFamily: 'var(--font-mono)',
  color: 'var(--color-accent)', background: 'var(--color-bg-raised)',
  padding: '3px 8px', borderRadius: 'var(--radius-sm)',
};

const selectorRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  marginTop: 'var(--space-lg)', flexWrap: 'wrap',
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

const pathLabel: React.CSSProperties = {
  fontSize: '12px', fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-muted)',
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

const thSize: React.CSSProperties = {
  ...th, width: '100px',
};

const thAction: React.CSSProperties = {
  ...th, textAlign: 'right', width: '100px',
};

const td: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid var(--color-border)',
};

const tdSize: React.CSSProperties = {
  ...td, color: 'var(--color-text-muted)', fontSize: '13px', fontFamily: 'var(--font-mono)',
};

const tdAction: React.CSSProperties = {
  ...td, textAlign: 'right',
};

const fileName: React.CSSProperties = {
  fontSize: '13px', fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-secondary)',
};

const deleteBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: '11px', fontWeight: 500,
  color: 'var(--color-danger)', background: 'var(--color-danger-dim)',
  border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-pill)',
  cursor: 'pointer', fontFamily: 'var(--font-body)',
  textTransform: 'uppercase', letterSpacing: '1px',
};

const feedbackText: React.CSSProperties = {
  fontSize: '12px', color: 'var(--color-success)', fontFamily: 'var(--font-mono)',
};

const usageCard: React.CSSProperties = {
  marginTop: 'var(--space-lg)', padding: '24px',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const usageTitle: React.CSSProperties = {
  fontSize: '14px', fontWeight: 500, margin: '0 0 8px',
  color: 'var(--color-text-primary)',
};

const usageDesc: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px',
};

const usageList: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '8px',
};

const usageItem: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-secondary)',
};

function tierBadgeColor(tier: string): React.CSSProperties {
  switch (tier) {
    case 'company': return { background: 'var(--color-accent-dim)', color: 'var(--color-accent)' };
    case 'group': return { background: 'var(--color-warning-dim)', color: 'var(--color-warning)' };
    default: return { background: 'var(--color-success-dim)', color: 'var(--color-success)' };
  }
}

const tierSection: React.CSSProperties = {
  marginTop: 'var(--space-lg)',
  padding: '24px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
};

const tierHead: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px',
};

const tierTitle: React.CSSProperties = {
  fontSize: '16px', fontWeight: 500, margin: 0, fontFamily: 'var(--font-body)',
  color: 'var(--color-text-primary)',
};

const tierTenant: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)',
};

const tierTabs: React.CSSProperties = {
  display: 'flex', gap: '4px', marginBottom: '16px',
};

const tabActive: React.CSSProperties = {
  padding: '5px 14px', border: 'none', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-accent)', color: 'white', fontSize: '13px',
  fontFamily: 'var(--font-body)', cursor: 'pointer', fontWeight: 500,
};

const tabInactive: React.CSSProperties = {
  padding: '5px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  background: 'transparent', color: 'var(--color-text-muted)', fontSize: '13px',
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};

const tierGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--space-sm)',
};

const tierCard: React.CSSProperties = {
  padding: '14px',
  background: 'var(--color-bg-raised)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const tierCardHead: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px',
};

const tierCardName: React.CSSProperties = {
  fontSize: '14px', fontWeight: 500, fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-primary)',
};

const tierCardMeta: React.CSSProperties = {
  fontSize: '12px', color: 'var(--color-text-muted)',
};

const tierBadge: React.CSSProperties = {
  fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
  fontWeight: 500, letterSpacing: '0.5px', flexShrink: 0,
};
