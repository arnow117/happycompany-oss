import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';

interface BootstrapStatus {
  configured: boolean;
  steps: {
    modelConfigured: boolean;
    employeeNetworkReady: boolean;
    peopleBound: boolean;
  };
}

interface OnboardingBannerProps {
  isFullHeight?: boolean;
}

export function OnboardingBanner({ isFullHeight }: OnboardingBannerProps) {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem('onboarding-dismissed');
    if (stored) {
      setDismissed(stored === 'true');
    }

    api.getBootstrapStatus()
      .then((data) => setStatus(data))
      .catch(() => {});
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('onboarding-dismissed', 'true');
  };

  if (!status || dismissed) return null;
  if (status.steps.modelConfigured && status.steps.employeeNetworkReady && status.steps.peopleBound) {
    return null;
  }
  if (isFullHeight) return null;

  let stepInfo: { step: number; name: string; path: string } | null = null;
  if (!status.steps.modelConfigured) {
    stepInfo = { step: 1, name: '配置模型', path: '/model-config' };
  } else if (!status.steps.employeeNetworkReady) {
    stepInfo = { step: 2, name: '创建数字员工', path: '/employees' };
  } else if (!status.steps.peopleBound) {
    stepInfo = { step: 3, name: '绑定人员', path: '/people' };
  }

  if (!stepInfo) return null;

  const completed = [
    status.steps.modelConfigured,
    status.steps.employeeNetworkReady,
    status.steps.peopleBound,
  ].filter(Boolean).length;
  const total = 3;

  return (
    <div style={banner}>
      {/* slim progress track */}
      <div style={progressTrack} aria-hidden="true">
        <div style={{ ...progressFill, width: `${(completed / total) * 100}%` }} />
      </div>

      <div style={row}>
        <span style={stepBadge}>{completed}/{total}</span>
        <span style={bannerText}>
          完成初始设置 · 下一步：<strong style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{stepInfo.name}</strong>
        </span>
        <div style={bannerActions}>
          <button onClick={() => navigate(stepInfo.path)} style={continueBtn}>
            继续
            <ArrowRight size={13} />
          </button>
          <button onClick={handleDismiss} style={dismissBtn} aria-label="暂时隐藏" title="暂时隐藏">
            <X size={15} color="var(--color-text-muted)" />
          </button>
        </div>
      </div>
    </div>
  );
}

const banner: React.CSSProperties = {
  position: 'relative',
  background: 'var(--color-bg-base)',
  borderBottom: '1px solid var(--color-border)',
};

const progressTrack: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  background: 'var(--color-bg-overlay)',
};

const progressFill: React.CSSProperties = {
  height: '100%',
  background: 'var(--color-accent)',
  transition: 'width var(--transition-normal) var(--ease-out-expo)',
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 24px',
};

const stepBadge: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--color-accent)',
  background: 'var(--color-accent-dim)',
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill)',
};

const bannerText: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const bannerActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0,
};

const continueBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 12px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  transition: 'background var(--transition-fast) var(--ease-out-expo)',
};

const dismissBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  transition: 'background var(--transition-fast) var(--ease-out-expo)',
};
