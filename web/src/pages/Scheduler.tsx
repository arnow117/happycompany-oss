import { Fragment, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

/* ── Types ────────────────────────────────────────────────── */

interface ScheduledTask {
  id: string;
  name: string;
  botName: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  runCount: number;
}

/* ── Component ────────────────────────────────────────────── */

export function Scheduler() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    scheduleType: 'cron' as 'cron' | 'interval' | 'once',
    scheduleValue: '',
    prompt: '',
  });
  const [form, setForm] = useState({
    name: '',
    botName: '',
    scheduleType: 'cron' as 'cron' | 'interval' | 'once',
    scheduleValue: '',
    prompt: '',
  });
  const [bots, setBots] = useState<{ name: string; displayName: string }[]>([]);

  const loadTasks = useCallback(() => {
    api.listScheduledTasks()
      .then(setTasks)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load tasks'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTasks();
    api.health().then((h) => setBots(h.bots.map((b) => ({ name: b.name, displayName: b.displayName }))));
  }, [loadTasks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createScheduledTask(form);
      setShowForm(false);
      setForm({ name: '', botName: '', scheduleType: 'cron', scheduleValue: '', prompt: '' });
      loadTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      await api.updateScheduledTask(task.id, { enabled: !task.enabled });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: !task.enabled } : t)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to toggle task');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.deleteScheduledTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      await api.triggerScheduledTask(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to trigger task');
    }
  };

  const startEdit = (task: ScheduledTask) => {
    setEditingId(task.id);
    setEditForm({
      name: task.name,
      scheduleType: task.scheduleType,
      scheduleValue: task.scheduleValue,
      prompt: task.prompt,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    try {
      const updated = await api.updateScheduledTask(editingId, editForm);
      setTasks((prev) => prev.map((t) => (t.id === editingId ? { ...t, ...updated } : t)));
      setEditingId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const fmt = (ts: number | null) =>
    ts && ts > 1000000000000 ? new Date(ts).toLocaleString() : '--';

  const scheduleLabel = (t: ScheduledTask) => {
    if (t.scheduleType === 'once') return `Once: ${t.scheduleValue}`;
    if (t.scheduleType === 'interval') return `Every ${t.scheduleValue}`;
    return `Cron: ${t.scheduleValue}`;
  };

  if (loading) {
    return <div style={loadingState}>Loading scheduler...</div>;
  }

  return (
    <section>
      <div style={headerRow}>
        <div>
          <h2 style={heading}>Scheduler</h2>
          <p style={subtitle}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}, {tasks.filter((t) => t.enabled).length} active.
          </p>
        </div>
        <button style={addBtn} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Task'}
        </button>
      </div>

      {error && <div style={errorBanner}>{error}</div>}

      {showForm && (
        <form style={formCard} onSubmit={handleSubmit}>
          <h3 style={formTitle}>New Scheduled Task</h3>
          <div style={formGrid}>
            <label style={label}>Name</label>
            <input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />

            <label style={label}>Bot</label>
            <select style={input} value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} required>
              <option value="">Select bot...</option>
              {bots.map((b) => (
                <option key={b.name} value={b.name}>{b.displayName || b.name}</option>
              ))}
            </select>

            <label style={label}>Schedule Type</label>
            <select style={input} value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value as ScheduledTask['scheduleType'] })}>
              <option value="cron">Cron</option>
              <option value="interval">Interval (ISO 8601)</option>
              <option value="once">Once (ISO datetime)</option>
            </select>

            <label style={label}>Schedule Value</label>
            <input
              style={input}
              value={form.scheduleValue}
              onChange={(e) => setForm({ ...form, scheduleValue: e.target.value })}
              placeholder={form.scheduleType === 'cron' ? '* * * * *' : form.scheduleType === 'interval' ? 'PT30M' : '2026-12-31T09:00:00Z'}
              required
            />

            <label style={label}>Prompt</label>
            <textarea style={{ ...input, minHeight: '80px', resize: 'vertical' }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} required />
          </div>
          <button style={submitBtn} type="submit">Create Task</button>
        </form>
      )}

      {tasks.length === 0 ? (
        <div style={emptyState}>
          No scheduled tasks yet. Click "Add Task" to create one.
        </div>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={thName}>Name</th>
              <th style={thBot}>Bot</th>
              <th style={thSchedule}>Schedule</th>
              <th style={thStatus}>Status</th>
              <th style={thRun}>Runs</th>
              <th style={thDate}>Last Run</th>
              <th style={thDate}>Next Run</th>
              <th style={thActions}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <Fragment key={task.id}>
              <tr style={tr}>
                <td style={td}><span style={nameText}>{task.name}</span></td>
                <td style={td}><span style={botText}>{task.botName}</span></td>
                <td style={td}><span style={scheduleText}>{scheduleLabel(task)}</span></td>
                <td style={td}>
                  <span style={{
                    ...badge,
                    background: task.enabled ? 'var(--color-success-dim)' : 'var(--color-border-soft)',
                    color: task.enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                  }}>
                    {task.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td style={td}>{task.runCount}</td>
                <td style={tdDate}>{fmt(task.lastRunAt)}</td>
                <td style={tdDate}>{fmt(task.nextRunAt)}</td>
                <td style={td}>
                  <div style={actionGroup}>
                    <button style={smallBtn} onClick={() => startEdit(task)} title="Edit">Edit</button>
                    <button style={smallBtn} onClick={() => handleTrigger(task.id)} title="Trigger now">Run</button>
                    <button
                      style={{ ...smallBtn, opacity: task.enabled ? 0.6 : 1 }}
                      onClick={() => handleToggle(task)}
                    >
                      {task.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button style={{ ...smallBtn, color: 'var(--color-danger)' }} onClick={() => handleDelete(task.id)}>Del</button>
                  </div>
                </td>
              </tr>
              {editingId === task.id && (
                <tr key={`${task.id}-edit`} style={editRow}>
                  <td colSpan={8} style={editCell}>
                    <div style={formGrid}>
                      <label style={label}>Name</label>
                      <input style={input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                      <label style={label}>Schedule Type</label>
                      <select style={input} value={editForm.scheduleType} onChange={(e) => setEditForm({ ...editForm, scheduleType: e.target.value as ScheduledTask['scheduleType'] })}>
                        <option value="cron">Cron</option>
                        <option value="interval">Interval</option>
                        <option value="once">Once</option>
                      </select>
                      <label style={label}>Schedule Value</label>
                      <input style={input} value={editForm.scheduleValue} onChange={(e) => setEditForm({ ...editForm, scheduleValue: e.target.value })} />
                      <label style={label}>Prompt</label>
                      <textarea style={{ ...input, minHeight: '60px', resize: 'vertical' }} value={editForm.prompt} onChange={(e) => setEditForm({ ...editForm, prompt: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <button style={submitBtn} onClick={handleEditSave}>Save</button>
                      <button style={cancelBtn} onClick={cancelEdit}>Cancel</button>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ── Inline styles ────────────────────────────────────────── */

const loadingState: React.CSSProperties = { padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' };
const heading: React.CSSProperties = { fontSize: '36px', fontWeight: 400, fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', margin: 0, color: 'var(--color-text-primary)' };
const subtitle: React.CSSProperties = { fontSize: '16px', color: 'var(--color-text-muted)', margin: '8px 0 0' };
const headerRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' };
const addBtn: React.CSSProperties = { marginTop: '4px', padding: '10px 20px', height: '40px', fontSize: '14px', fontWeight: 500, color: 'var(--color-on-dark)', background: 'var(--color-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-body)' };
const errorBanner: React.CSSProperties = { marginTop: 'var(--space-md)', padding: '12px 20px', background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: '14px' };
const emptyState: React.CSSProperties = { marginTop: 'var(--space-xl)', padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '14px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' };
const formCard: React.CSSProperties = { marginTop: 'var(--space-lg)', padding: '24px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' };
const formTitle: React.CSSProperties = { fontSize: '18px', fontWeight: 500, margin: '0 0 16px', color: 'var(--color-text-primary)' };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px 16px', alignItems: 'start' };
const label: React.CSSProperties = { fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', paddingTop: '8px' };
const input: React.CSSProperties = { padding: '8px 12px', fontSize: '14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-deep)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', width: '100%', boxSizing: 'border-box' as const };
const submitBtn: React.CSSProperties = { marginTop: '16px', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-on-dark)', background: 'var(--color-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-body)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: 'var(--space-lg)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)' };
const tr: React.CSSProperties = { borderBottom: '1px solid var(--color-border-soft)' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '14px', verticalAlign: 'top' };
const thName: React.CSSProperties = { ...td, width: '120px', fontWeight: 500 };
const thBot: React.CSSProperties = { ...td, width: '80px', fontWeight: 500 };
const thSchedule: React.CSSProperties = { ...td, width: '160px', fontWeight: 500 };
const thStatus: React.CSSProperties = { ...td, width: '70px', fontWeight: 500 };
const thRun: React.CSSProperties = { ...td, width: '50px', fontWeight: 500 };
const thDate: React.CSSProperties = { ...td, width: '140px', fontWeight: 500 };
const thActions: React.CSSProperties = { ...td, width: '160px', fontWeight: 500 };
const nameText: React.CSSProperties = { fontWeight: 500, color: 'var(--color-text-primary)' };
const botText: React.CSSProperties = { fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' };
const scheduleText: React.CSSProperties = { fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' };
const tdDate: React.CSSProperties = { ...td, fontSize: '13px', color: 'var(--color-text-muted)' };
const badge: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', borderRadius: 'var(--radius-pill)' };
const actionGroup: React.CSSProperties = { display: 'flex', gap: '6px' };
const smallBtn: React.CSSProperties = { padding: '4px 10px', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const editRow: React.CSSProperties = { background: 'var(--color-bg-overlay)' };
const editCell: React.CSSProperties = { padding: '16px', borderBottom: '1px solid var(--color-border)' };
const cancelBtn: React.CSSProperties = { padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-muted)', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-body)' };
