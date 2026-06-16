import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Channel = 'feishu' | 'dingtalk';
type ProviderMode = 'official' | 'third_party';

const THIRD_PARTY_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku', 'haiku[1m]'];

export function Setup() {
  const [step, setStep] = useState(0);
  const [providerMode, setProviderMode] = useState<ProviderMode>('third_party');

  // Official mode
  const [apiKey, setApiKey] = useState('');

  // Third-party mode
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [model, setModel] = useState('');

  // Bot
  const [channel, setChannel] = useState<Channel>('dingtalk');
  const [botName, setBotName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const credFields: Record<Channel, Array<{ key: string; label: string; placeholder: string }>> = {
    feishu: [
      { key: 'appId', label: 'App ID', placeholder: '输入飞书 App ID' },
      { key: 'appSecret', label: 'App Secret', placeholder: '输入飞书 App Secret' },
    ],
    dingtalk: [
      { key: 'clientId', label: 'Client ID', placeholder: '输入钉钉 Client ID' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: '输入钉钉 Client Secret' },
    ],
  };

  const validateStep = (): boolean => {
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

  const handleNext = () => {
    if (!validateStep()) return;
    setStep(1);
  };

  const handleFinish = async () => {
    setLoading(true);
    setError('');
    try {
      const bots = botName.trim()
        ? [{ name: botName.trim(), channel, credentials, displayName: displayName.trim() || botName.trim() }]
        : undefined;
      const result = await api.saveAdminConfig({
        ...(providerMode === 'official'
          ? { apiKey: apiKey.trim() }
          : { baseUrl: baseUrl.trim(), authToken: authToken.trim(), ...(model.trim() && { model: model.trim() }) }),
        bots,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      navigate('/config', { replace: true });
      window.location.reload();
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
          <div style={stepIndicator}>
            STEP {step + 1} / 2
          </div>
          <h1 style={heading}>
            {step === 0 ? '配置模型接入' : '创建 Bot'}
          </h1>
          <p style={subheading}>
            {step === 0
              ? '选择模型接入方式，填写对应凭据。完成后可进入后台继续配置消息通道。'
              : '绑定飞书或钉钉，即可通过 IM 与 AI 对话。跳过后也可在后台随时配置。'}
          </p>
        </div>

        {error && <div style={errorBanner}>{error}</div>}

        {/* Step 1: Provider config */}
        {step === 0 && (
          <section style={section}>
            <div style={sectionContent}>
              {/* Mode toggle */}
              <div style={modeToggle}>
                <button
                  type="button"
                  onClick={() => { setProviderMode('third_party'); setError(''); }}
                  style={{
                    ...modeTab,
                    ...(providerMode === 'third_party' ? modeTabActive : {}),
                  }}
                >
                  第三方渠道
                </button>
                <button
                  type="button"
                  onClick={() => { setProviderMode('official'); setError(''); }}
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
        )}

        {/* Step 2: Bot */}
        {step === 1 && (
          <section style={section}>
            <div style={sectionContent}>
              {/* Channel selector */}
              <div style={channelTabs}>
                {(['dingtalk', 'feishu'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => { setChannel(ch); setCredentials({}); }}
                    style={{
                      ...channelTab,
                      ...(channel === ch ? channelTabActive : {}),
                    }}
                  >
                    {ch === 'dingtalk' ? '钉钉' : '飞书'}
                  </button>
                ))}
              </div>

              {/* Bot name */}
              <label style={label}>
                Bot 名称
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="例如：my-bot"
                  style={input}
                />
              </label>

              {/* Display name */}
              <label style={label}>
                显示名称
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例如：我的助手"
                  style={input}
                />
              </label>

              {/* Credentials grid */}
              <div style={credGrid}>
                {credFields[channel].map(({ key, label: fieldLabel, placeholder }) => (
                  <label key={key} style={label}>
                    {fieldLabel}
                    <input
                      type="password"
                      value={credentials[key] ?? ''}
                      onChange={(e) => setCredentials((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={placeholder}
                      style={input}
                    />
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Navigation */}
        <div style={nav}>
          <div style={navLeft}>
            {step > 0 && (
              <button type="button" onClick={() => { setStep(step - 1); setError(''); }} style={btnSecondary}>
                &larr; 上一步
              </button>
            )}
          </div>
          <div style={navRight}>
            {step === 0 && (
              <button type="button" onClick={handleNext} style={btnPrimary}>
                下一步 &rarr;
              </button>
            )}
            {step === 1 && (
              <>
                <button type="button" onClick={handleFinish} disabled={loading} style={btnGhost}>
                  跳过，稍后配置
                </button>
                <button type="button" onClick={handleFinish} disabled={loading} style={btnPrimary}>
                  {loading ? '保存中...' : '完成设置 &rarr;'}
                </button>
              </>
            )}
          </div>
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

const stepIndicator: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--color-accent)',
  letterSpacing: '1.5px',
  marginBottom: '8px',
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

/* ── Error / Info ───────────────────────────────────────── */

const errorBanner: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
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

/* ── Channel tabs ──────────────────────────────────────── */

const channelTabs: React.CSSProperties = {
  display: 'inline-flex',
  gap: '2px',
  background: 'var(--color-surface-dark-elevated)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px',
};

const channelTab: React.CSSProperties = {
  padding: '7px 20px',
  borderRadius: 'calc(var(--radius-sm) - 2px)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const channelTabActive: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  color: 'var(--color-accent)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
};

/* ── Credential grid ───────────────────────────────────── */

const credGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
};

/* ── Navigation ────────────────────────────────────────── */

const nav: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const navLeft: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
};

const navRight: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
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

const btnGhost: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};
