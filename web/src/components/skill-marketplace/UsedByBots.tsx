import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

interface EmployeeEntry {
  id: string;
  displayName: string;
  role: string;
  tenant: string;
}

interface UsedByBotsProps {
  skillName: string;
}

const wrap: React.CSSProperties = {
  marginTop: 'var(--space-md)',
  padding: '14px 16px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const title: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  marginBottom: '10px',
};

const list: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
};

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-bg-raised)',
  color: 'var(--color-text-primary)',
  textDecoration: 'none',
  fontSize: 'var(--text-sm)',
};

const roleBadge: React.CSSProperties = {
  fontSize: '10px',
  padding: '1px 6px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-accent-dim)',
  color: 'var(--color-accent)',
};

const emptyText: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-muted)',
  margin: 0,
};

export function UsedByBots({ skillName }: UsedByBotsProps) {
  const [employees, setEmployees] = useState<EmployeeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEmployees(null);
    setError(null);
    api.listEmployeesBySkill(skillName)
      .then((res) => { if (!cancelled) setEmployees(res); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => { cancelled = true; };
  }, [skillName]);

  return (
    <div style={wrap}>
      <div style={title}>
        被数字员工使用 {employees ? `(${employees.length})` : ''}
      </div>
      {error && <p style={{ ...emptyText, color: 'var(--color-danger)' }}>{error}</p>}
      {!error && employees === null && <p style={emptyText}>Loading...</p>}
      {!error && employees && employees.length === 0 && (
        <p style={emptyText}>暂无数字员工声明此技能。</p>
      )}
      {!error && employees && employees.length > 0 && (
        <div style={list}>
          {employees.map((emp) => (
            <Link key={emp.id} to="/employees" style={chip} title={`${emp.role} · ${emp.tenant}`}>
              {emp.displayName}
              {emp.role && <span style={roleBadge}>{emp.role}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
