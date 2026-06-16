import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
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

  let stepInfo: { step: number; name: string; path: string } | null = null;
  if (!status.steps.modelConfigured) {
    stepInfo = { step: 1, name: '配置模型', path: '/model-config' };
  } else if (!status.steps.employeeNetworkReady) {
    stepInfo = { step: 2, name: '创建数字员工', path: '/employees' };
  } else if (!status.steps.peopleBound) {
    stepInfo = { step: 3, name: '绑定人员', path: '/people' };
  }

  if (!stepInfo) return null;

  if (isFullHeight) return null;

  return (
    <div style={banner}>
      <span style={bannerText}>
        步骤 {stepInfo.step} / 3: {stepInfo.name}
      </span>
      <div style={bannerActions}>
        <button
          onClick={() => navigate(stepInfo.path)}
          style={continueBtn}
        >
          继续配置
        </button>
        <button
          onClick={handleDismiss}
          style={dismissBtn}
          aria-label="Dismiss"
        >
          <X size={16} color="var(--color-on-dark-soft)" />
        </button>
      </div>
    </div>
  );
}

const banner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '12px 24px',
  background: 'rgba(251, 191, 36, 0.08)',
  borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
};

const bannerText: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-on-dark-soft)',
  flex: 1,
};

const bannerActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const continueBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-accent)',
  background: 'transparent',
  color: 'var(--color-accent)',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
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
