import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type ProviderMode = 'official' | 'third_party';

const THIRD_PARTY_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku', 'haiku[1m]'];

interface BootstrapStatus {
  configured: boolean;
  steps: {
    modelConfigured: boolean;
    employeeNetworkReady: boolean;
    peopleBound: boolean;
  };
}

export function ModelConfig() {
  const [providerMode, setProviderMode] = useState<ProviderMode>('third_party');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.getBootstrapStatus()
      .then((status: BootstrapStatus) => {
        setIsConfigured(status.steps.modelConfigured);
      })
      .catch(() => {});
  }, []);

  const validate = (): boolean => {
    if (providerMode === 'official') {
      if (!apiKey.trim()) {
        setError('请填写 Anthropic API Key');
        return false;
      }
    } else {
      if (!baseUrl.trim()) {
        setError('请填写 Base URL');
        return false;
      }
      if (!authToken.trim()) {
        setError('请填写 Auth Token');
        return false;
      }
    }
    setError('');
    return true;
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);
    try {
      if (providerMode === 'official') {
        setTestResult({ ok: true, message: '官方渠道无需测试' });
        return;
      }
      const result = await api.verifyModel({
        baseUrl: baseUrl.trim(),
        authToken: authToken.trim(),
        ...(model.trim() && { model: model.trim() }),
      });
      if (result.ok) {
        setTestResult({ ok: true, message: `连接成功${result.model ? `: ${result.model}` : ''}` });
      } else {
        setTestResult({ ok: false, message: result.error || '连接失败' });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.saveAdminConfig({
        ...(providerMode === 'official'
          ? { apiKey: apiKey.trim() }
          : { baseUrl: baseUrl.trim(), authToken: authToken.trim(), ...(model.trim() && { model: model.trim() }) }),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      navigate('/employees', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={page}>
      <div style={container}>
        {/* Header */}
        <div style={header}>
          {isConfigured && <div style={statusBadge}>已配置</div>}
          <h1 style={heading}>模型配置</h1>
          <p style={subheading}>
            选择模型接入方式，填写对应凭据。完成后进入数字员工配置。
          </p>
        </div>

        {error && <div style={errorBanner}>{error}</div>}
        {testResult && (
          <div style={{
            ...statusBanner,
            background: testResult.ok ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)',
            borderColor: testResult.ok ? 'rgba(74, 222, 128, 0.25)' : 'rgba(248, 113, 113, 0.25)',
            color: testResult.ok ? '#4ade80' : '#f87171',
          }}>
            {testResult.message}
          </div>
        )}

        {/* Section */}
        <section style={section}>
          <div style={sectionContent}>
            {/* Mode toggle */}
            <div style={modeToggle}>
              <button
                type="button"
                onClick={() => { setProviderMode('third_party'); setError(''); setTestResult(null); }}
                style={{
                  ...modeTab,
                  ...(providerMode === 'third_party' ? modeTabActive : {}),
                }}
              >
                第三方渠道
              </button>
              <button
                type="button"
                onClick={() => { setProviderMode('official'); setError(''); setTestResult(null); }}
                style={{
                  ...modeTab,
                  ...(providerMode === 'official' ? modeTabActive : {}),
                }}
              >
                官方渠道
              </button>
            </div>

            {providerMode === 'official' ? (
              <OfficialFields apiKey={apiKey} onApiKeyChange={setApiKey} />
            ) : (
              <ThirdPartyFields
                baseUrl={baseUrl}
                authToken={authToken}
                model={model}
                onBaseUrlChange={setBaseUrl}
                onAuthTokenChange={setAuthToken}
                onModelChange={setModel}
              />
            )}
          </div>
        </section>

        {/* Actions */}
        <div style={actions}>
          {providerMode === 'third_party' && (
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              style={btnSecondary}
            >
              {testing ? '测试中...' : '测试连接'}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            style={btnPrimary}
          >
            {loading ? '保存中...' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Provider fields ────────────────────────────────────── */

function OfficialFields({
  apiKey,
  onApiKeyChange,
}: {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
}) {
  return (
    <>
      <label style={label}>
        Anthropic API Key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="sk-ant-api03-..."
          style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
          autoFocus
        />
      </label>
      <p style={hint}>
        前往{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={link}>
          console.anthropic.com
        </a>{' '}
        创建 API Key，将以 <code style={code}>sk-ant-api03-</code> 开头。
      </p>
    </>
  );
}

function ThirdPartyFields({
  baseUrl,
  authToken,
  model,
  onBaseUrlChange,
  onAuthTokenChange,
  onModelChange,
}: {
  baseUrl: string;
  authToken: string;
  model: string;
  onBaseUrlChange: (v: string) => void;
  onAuthTokenChange: (v: string) => void;
  onModelChange: (v: string) => void;
}) {
  return (
    <>
      <div style={infoBox}>
        <span style={infoIcon}>i</span>
        <span style={infoText}>第三方渠道会将配置写入系统全局环境变量。必填项为 Base URL 和 Auth Token。</span>
      </div>
      <label style={label}>
        Base URL（必填）
        <input
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder="https://your-relay.example.com/v1"
          style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
          autoFocus
        />
      </label>
      <label style={label}>
        Auth Token（必填）
        <input
          type="password"
          value={authToken}
          onChange={(e) => onAuthTokenChange(e.target.value)}
          placeholder="输入第三方网关 Token"
          style={input}
        />
      </label>
      <label style={label}>
        模型名称（可选）
        <input
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="例如：sonnet、opus[1m]、haiku"
          style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
        />
        <datalist id="model-suggestions">
          {THIRD_PARTY_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
    </>
  );
}

/* ── Layout ────────────────────────────────────────────── */

const page: React.CSSProperties = {
  padding: '24px 16px',
  display: 'flex',
  justifyContent: 'center',
};

const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '520px',
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
};

const header: React.CSSProperties = {
  textAlign: 'center',
};

const statusBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(74, 222, 128, 0.1)',
  border: '1px solid rgba(74, 222, 128, 0.25)',
  color: '#4ade80',
  fontSize: '12px',
  fontWeight: 500,
  marginBottom: '12px',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--color-on-dark)',
  marginBottom: '8px',
};

const subheading: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

/* ── Error / Info / Status ───────────────────────────────── */

const errorBanner: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
  fontSize: '13px',
};

const statusBanner: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid',
  fontSize: '13px',
};

const infoBox: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-start',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
  fontSize: '12px',
  lineHeight: 1.5,
};

const infoIcon: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '11px',
  fontWeight: 700,
  flexShrink: 0,
};

const infoText: React.CSSProperties = {
  color: 'var(--color-on-dark-soft)',
};

/* ── Section card ──────────────────────────────────────── */

const section: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border, var(--color-surface-dark-elevated))',
  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
};

const sectionContent: React.CSSProperties = {
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

/* ── Form elements ─────────────────────────────────────── */

const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
};

const input: React.CSSProperties = {
  background: 'var(--color-surface-dark-elevated)',
  border: '1px solid var(--color-surface-dark-elevated)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  fontSize: '14px',
  color: 'var(--color-on-dark)',
  fontFamily: 'var(--font-body)',
  outline: 'none',
  boxSizing: 'border-box' as const,
  width: '100%',
};

const hint: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

const code: React.CSSProperties = {
  background: 'var(--color-surface-dark-elevated)',
  padding: '1px 4px',
  borderRadius: '3px',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '12px',
};

const link: React.CSSProperties = {
  color: 'var(--color-accent)',
  textDecoration: 'none',
};

/* ── Mode toggle (provider) ────────────────────────────── */

const modeToggle: React.CSSProperties = {
  display: 'inline-flex',
  gap: '2px',
  background: 'var(--color-surface-dark-elevated)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px',
};

const modeTab: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 'calc(var(--radius-sm) - 2px)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const modeTabActive: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  color: 'var(--color-accent)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
};

/* ── Actions ───────────────────────────────────────────── */

const actions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};
