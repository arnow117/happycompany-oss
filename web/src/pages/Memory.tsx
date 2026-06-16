import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

type MemorySubject = {
  key: string;
  name: string;
  displayName: string;
  kind: 'entry' | 'employee';
  tenantName?: string;
};

export function Memory() {
  const [selectedSubjectKey, setSelectedSubjectKey] = useState('');
  const [subjects, setSubjects] = useState<MemorySubject[]>([]);
  const [sources, setSources] = useState<Array<{ file: string; type: string; size: number }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ file: string; line: number; context: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.health(), api.listEmployees()])
      .then(([h, employeesRes]) => {
        const entrySubjects: MemorySubject[] = h.bots.map((b) => ({
          key: `entry:${b.tenant ?? ''}:${b.name}`,
          name: b.name,
          displayName: b.displayName || b.name,
          kind: 'entry',
          tenantName: b.tenant,
        }));
        const employeeSubjects: MemorySubject[] = employeesRes.employees.map((employee) => ({
          key: `employee:${employee.tenantName ?? ''}:${employee.id}`,
          name: employee.id,
          displayName: employee.displayName || employee.id,
          kind: 'employee',
          tenantName: employee.tenantName,
        }));
        const nextSubjects = [...entrySubjects, ...employeeSubjects];
        setSubjects(nextSubjects);
        if (nextSubjects.length > 0 && !selectedSubjectKey) {
          setSelectedSubjectKey(nextSubjects[0].key);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load memory subjects'),
      );
  }, []);

  const selectedSubject = subjects.find((subject) => subject.key === selectedSubjectKey);
  const selectedBot = selectedSubject?.name ?? '';
  const selectedTenant = selectedSubject?.tenantName;

  const loadSources = useCallback(() => {
    if (!selectedBot) return;
    setLoading(true);
    setError(null);
    api.listMemorySources(selectedBot, selectedTenant)
      .then((res) => setSources(res.data ?? []))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load sources'),
      )
      .finally(() => setLoading(false));
  }, [selectedBot, selectedTenant]);

  useEffect(() => { loadSources(); }, [loadSources]);

  const handleSearch = useCallback(() => {
    if (!selectedBot || !searchQuery.trim()) return;
    setIsSearching(true);
    api.searchMemory(selectedBot, searchQuery.trim(), selectedTenant)
      .then((res) => setSearchResults(res.data ?? []))
      .catch(() => setSearchResults([]))
      .finally(() => setIsSearching(false));
  }, [selectedBot, searchQuery, selectedTenant]);

  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    setIsEditing(false);
    setFileLoading(true);
    setSaveFeedback(null);
    api.readMemoryFile(selectedBot, filePath, selectedTenant)
      .then((res) => {
        setFileContent(res.data ?? '');
        setEditContent(res.data ?? '');
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to read file'),
      )
      .finally(() => setFileLoading(false));
  }, [selectedBot, selectedTenant]);

  const handleSave = useCallback(() => {
    if (!selectedBot || !selectedFile) return;
    setIsSaving(true);
    api.writeMemoryFile(selectedBot, selectedFile, editContent, selectedTenant)
      .then(() => {
        setFileContent(editContent);
        setIsEditing(false);
        setSaveFeedback('Saved');
        setTimeout(() => setSaveFeedback(null), 2000);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Save failed'),
      )
      .finally(() => setIsSaving(false));
  }, [selectedBot, selectedFile, editContent, selectedTenant]);

  const backToSources = useCallback(() => {
    setSelectedFile(null);
    setFileContent('');
    setEditContent('');
    setIsEditing(false);
    setSearchResults([]);
    setSearchQuery('');
    loadSources();
  }, [loadSources]);

  if (selectedFile) {
    return (
      <section>
        <div style={headerRow}>
          <button onClick={backToSources} style={backBtn}>
            ← 返回列表
          </button>
          <h2 style={heading}>Memory</h2>
        </div>
        <p style={subtitle}>{selectedSubject?.displayName ?? selectedBot} / {selectedFile}</p>

        {error && <div style={errorBanner}>{error}</div>}

        {fileLoading && <div style={loadingState}>Loading...</div>}

        {!fileLoading && (
          <div style={editorWrap}>
            <div style={editorToolbar}>
              {!isEditing ? (
                <button onClick={() => setIsEditing(true)} style={editBtn}>
                  编辑
                </button>
              ) : (
                <>
                  <button onClick={handleSave} disabled={isSaving} style={saveBtn}>
                    {isSaving ? 'Saving...' : '保存'}
                  </button>
                  <button onClick={() => { setEditContent(fileContent); setIsEditing(false); }} style={cancelBtn}>
                    取消
                  </button>
                </>
              )}
              {saveFeedback && <span style={feedbackText}>{saveFeedback}</span>}
            </div>
            <textarea
              value={isEditing ? editContent : fileContent}
              onChange={(e) => setEditContent(e.target.value)}
              readOnly={!isEditing}
              style={editor}
            />
          </div>
        )}
      </section>
    );
  }

  const displayedFiles = searchResults.length > 0 || isSearching ? searchResults : sources;

  return (
    <section>
      <h2 style={heading}>Memory</h2>
      <p style={subtitle}>浏览和管理入口或数字员工 workspace 下的 memory 文件。聊天原文仍在 MessageStore，SDK session 文件只保存 sessionId。</p>

      {error && <div style={errorBanner}>{error}</div>}

      <div style={selectorRow}>
        <label style={selectorLabel}>对象</label>
        <select style={selector} value={selectedSubjectKey} onChange={(e) => { setSelectedSubjectKey(e.target.value); setSelectedFile(null); }}>
          {subjects.map((subject) => (
            <option key={subject.key} value={subject.key}>
              {subject.kind === 'employee' ? '员工' : '入口'} · {subject.displayName}
              {subject.tenantName ? ` (${subject.tenantName})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={searchRow}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索记忆文件..."
          style={searchInput}
        />
        <button onClick={handleSearch} disabled={isSearching} style={searchBtn}>
          {isSearching ? '...' : '搜索'}
        </button>
        {searchResults.length > 0 && (
          <button onClick={() => { setSearchResults([]); setSearchQuery(''); }} style={clearSearchBtn}>
            清除
          </button>
        )}
      </div>

      {loading && <div style={loadingState}>Loading...</div>}

      {!loading && displayedFiles.length === 0 && (
        <div style={emptyState}>
          {searchQuery ? '没有匹配的文件' : '暂无记忆文件'}
        </div>
      )}

      {!loading && displayedFiles.length > 0 && (
        <div style={fileList}>
          {displayedFiles.map((f) => (
            <button key={f.file} onClick={() => handleFileSelect(f.file)} style={fileItem}>
              <code style={fileName}>{f.file}</code>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '16px' };
const backBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-body)',
  padding: '4px 12px', cursor: 'pointer',
};
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
const selectorRow: React.CSSProperties = {
  marginTop: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: '12px',
};
const selectorLabel: React.CSSProperties = {
  fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)',
};
const selector: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
  background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', fontSize: '14px',
  fontFamily: 'var(--font-body)', minWidth: '180px',
};
const searchRow: React.CSSProperties = {
  marginTop: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px',
};
const searchInput: React.CSSProperties = {
  flex: 1, padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
  background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', fontSize: '14px',
  fontFamily: 'var(--font-body)', maxWidth: '400px',
};
const searchBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-accent)',
  background: 'var(--color-accent)', color: 'white', fontSize: '13px', fontWeight: 500,
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};
const clearSearchBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
  background: 'transparent', color: 'var(--color-text-muted)', fontSize: '13px',
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};
const fileList: React.CSSProperties = {
  marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: '2px',
  background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)', overflow: 'hidden',
};
const fileItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', border: 'none',
  background: 'transparent', cursor: 'pointer',
  transition: 'background 150ms',
};
const fileName: React.CSSProperties = {
  fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)',
};
const editorWrap: React.CSSProperties = { marginTop: 'var(--space-lg)' };
const editorToolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
};
const editBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-accent)',
  background: 'transparent', color: 'var(--color-accent)', fontSize: '13px', fontWeight: 500,
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};
const saveBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--color-accent)', color: 'white', fontSize: '13px', fontWeight: 500,
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};
const cancelBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
  background: 'transparent', color: 'var(--color-text-muted)', fontSize: '13px',
  fontFamily: 'var(--font-body)', cursor: 'pointer',
};
const feedbackText: React.CSSProperties = {
  fontSize: '13px', color: 'var(--color-success)',
};
const editor: React.CSSProperties = {
  width: '100%', minHeight: '400px', padding: '16px', borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-border)', background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)', fontSize: '13px', lineHeight: '1.6',
  fontFamily: 'var(--font-mono)', resize: 'vertical',
};
