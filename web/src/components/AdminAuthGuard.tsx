import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { clearToken, getToken } from '../lib/auth';

type AuthState = 'checking' | 'authenticated' | 'anonymous';

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>('checking');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const token = getToken();
        const res = await fetch('/api/admin/session', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error('Unauthorized');
        if (!cancelled) setState('authenticated');
      } catch {
        clearToken();
        if (!cancelled) setState('anonymous');
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') {
    return (
      <div style={loadingPage}>
        <div style={loadingMark}>HC</div>
        <div>
          <p style={loadingTitle}>正在校验管理员身份</p>
          <p style={loadingSubtitle}>连接 HappyCompany 控制台...</p>
        </div>
      </div>
    );
  }

  if (state === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

const loadingPage: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '14px',
  background: 'var(--color-bg-deep)',
  color: 'var(--color-text-primary)',
};

const loadingMark: React.CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: 'var(--radius-md)',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--color-surface-dark)',
  color: 'var(--color-on-dark)',
  fontSize: '13px',
  fontWeight: 700,
};

const loadingTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
};

const loadingSubtitle: React.CSSProperties = {
  margin: '2px 0 0',
  fontSize: '12px',
  color: 'var(--color-text-muted)',
};
