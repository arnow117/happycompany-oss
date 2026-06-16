import { useState, useEffect } from 'react';
import { api, type WebChatConfig } from '../lib/api';

type Channel = 'feishu' | 'dingtalk' | 'web';
type ProviderMode = 'official' | 'third_party';

const THIRD_PARTY_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku', 'haiku[1m]'];

interface BotConfig {
  name: string;
  channel?: string;
  credentials?: Record<string, string>;
  displayName?: string;
  model?: string;
  authToken?: string;
  tenant?: string;
  routingMode?: 'direct' | 'employee-director';
  groupReplyMode?: 'mention-only' | 'all';
}

interface ConfigState {
  providerMode: ProviderMode;
  apiKey?: string;
  baseUrl?: string;
  authToken?: string;
  model?: string;
  webChat: WebChatConfig;
  bots: BotConfig[];
}

const DEFAULT_WEB_CHAT_CONFIG: WebChatConfig = {
  welcomeTitle: '你好，有什么可以帮你？',
  welcomeSubtitle: '选择下方话题快速开始，或直接输入你的问题。',
  inputPlaceholder: '输入消息... (Enter 发送)',
  historyLimit: 50,
  enableImageUpload: true,
  showSessionPicker: true,
  showQuickPrompts: true,
};

function generateBotId(channel: string | undefined, existingBots: BotConfig[]): string {
  const prefix = channel === 'feishu' ? 'feishu-bot' : channel === 'dingtalk' ? 'dingtalk-bot' : 'im-bot';
  const used = new Set(existingBots.map((bot) => bot.name));
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) {
    suffix += 1;
  }
  return `${prefix}-${suffix}`;
}

export function Config() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [revealingSecrets, setRevealingSecrets] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingWebChat, setEditingWebChat] = useState(false);
  const [addingBot, setAddingBot] = useState(false);
  const [editingBotIndex, setEditingBotIndex] = useState<number | null>(null);
  const [tenants, setTenants] = useState<{ id: string; displayName: string }[]>([]);
  const [botTesting, setBotTesting] = useState(false);
  const [botTestResult, setBotTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Config state
  const [config, setConfig] = useState<ConfigState>({
    providerMode: 'third_party',
    webChat: DEFAULT_WEB_CHAT_CONFIG,
    bots: [],
  });

  // New/Edit bot form state
  const [botForm, setBotForm] = useState<BotConfig>({
    name: '',
    channel: 'dingtalk',
    displayName: '',
    credentials: {},
    groupReplyMode: 'mention-only',
  });

  useEffect(() => {
    loadConfig();
    api.listTenants().then((r) => setTenants(r.tenants ?? [])).catch(() => {});
  }, []);

  const parseConfig = (data: Record<string, unknown>): ConfigState => {
    const claude = (data.claude ?? {}) as Record<string, unknown>;
    const providerMode = claude.baseUrl || claude.authToken ? 'third_party' : 'official';
    const botsData = data.bots as Record<string, unknown> | undefined;
    const bots = botsData
      ? Object.entries(botsData).map(([name, b]) => ({
          ...(b as Omit<BotConfig, 'name'>),
          name,
        }))
      : [];

    return {
      providerMode,
      apiKey: claude.apiKey as string | undefined,
      baseUrl: claude.baseUrl as string | undefined,
      authToken: claude.authToken as string | undefined,
      model: claude.model as string | undefined,
      webChat: {
        ...DEFAULT_WEB_CHAT_CONFIG,
        ...((data.webChat ?? {}) as Partial<WebChatConfig>),
      },
      bots,
    };
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      setConfig(parseConfig(data));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const revealConfig = async (): Promise<ConfigState | null> => {
    setError(null);
    setRevealingSecrets(true);
    try {
      const data = await api.revealAdminConfig();
      const revealed = parseConfig(data);
      setConfig(revealed);
      return revealed;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '读取明文密钥失败');
      return null;
    } finally {
      setRevealingSecrets(false);
    }
  };

  const toggleApiKeyVisibility = async () => {
    if (!config.apiKey) return;
    if (!showApiKey && isMaskedSecret(config.apiKey)) {
      if (await revealConfig()) setShowApiKey(true);
      return;
    }
    setShowApiKey((v) => !v);
  };

  const toggleAuthTokenVisibility = async () => {
    if (!config.authToken) return;
    if (!showAuthToken && isMaskedSecret(config.authToken)) {
      if (await revealConfig()) setShowAuthToken(true);
      return;
    }
    setShowAuthToken((v) => !v);
  };

  const getConfigForModelTest = async (): Promise<ConfigState | null> => {
    if (config.providerMode !== 'third_party') return config;
    if (!isMaskedSecret(config.authToken)) return config;
    return revealConfig();
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const ok = await persistConfig(config);
      if (ok) {
        setSuccess(true);
        setEditing(false);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  const buildSavePayload = (nextConfig: ConfigState) => {
    const modelConfig = nextConfig.providerMode === 'official'
      ? (isUsableSecret(nextConfig.apiKey) ? { apiKey: nextConfig.apiKey } : {})
      : {
          baseUrl: nextConfig.baseUrl,
          ...(isUsableSecret(nextConfig.authToken) ? { authToken: nextConfig.authToken } : {}),
          model: nextConfig.model,
        };
    return {
      ...modelConfig,
      webChat: nextConfig.webChat,
      bots: nextConfig.bots.map(sanitizeBotForSave),
    };
  };

  const persistConfig = async (nextConfig: ConfigState): Promise<boolean> => {
    const result = await api.saveAdminConfig(buildSavePayload(nextConfig));
    if (result.error) {
      setError(result.error);
      return false;
    }
    return true;
  };

  const handleAddBot = () => {
    setBotForm({ name: '', channel: 'dingtalk', displayName: '', credentials: {}, routingMode: 'direct', groupReplyMode: 'mention-only' });
    setBotTestResult(null);
    setAddingBot(true);
  };

  const handleSaveWebChat = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      if (await persistConfig(config)) {
        setEditingWebChat(false);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存 Web Chat 配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleEditBot = (index: number) => {
    setBotForm({ ...config.bots[index] });
    setBotTestResult(null);
    setEditingBotIndex(index);
  };

  const handleSaveBot = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    if (editingBotIndex !== null) {
      const newBots = [...config.bots];
      newBots[editingBotIndex] = botForm;
      const nextConfig = { ...config, bots: newBots };
      try {
        if (await persistConfig(nextConfig)) {
          setConfig(nextConfig);
          setEditingBotIndex(null);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '保存 Bot 失败');
      } finally {
        setLoading(false);
      }
    } else {
      const botToSave = {
        ...botForm,
        name: botForm.name || generateBotId(botForm.channel, config.bots),
      };
      const nextConfig = { ...config, bots: [...config.bots, botToSave] };
      try {
        if (await persistConfig(nextConfig)) {
          setConfig(nextConfig);
          setAddingBot(false);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '保存 Bot 失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDeleteBot = async (index: number) => {
    const bot = config.bots[index];
    if (confirm(`确认删除 Bot "${bot.displayName || bot.name}"?`)) {
      setLoading(true);
      setError(null);
      setSuccess(false);
      const nextConfig = { ...config, bots: config.bots.filter((_, i) => i !== index) };
      try {
        if (await persistConfig(nextConfig)) {
          setConfig(nextConfig);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '删除 Bot 失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleTestBot = async () => {
    setBotTesting(true);
    setBotTestResult(null);
    try {
      const res = await api.verifyBot({
        name: botForm.name || undefined,
        channel: botForm.channel,
        credentials: sanitizeCredentialsForSave(botForm.credentials),
      });
      setBotTestResult({
        ok: res.ok,
        msg: res.ok
          ? (res.botOpenId ? `连接成功 (${res.botOpenId})` : '连接成功')
          : (res.error || '连接失败'),
      });
    } catch (err: unknown) {
      setBotTestResult({ ok: false, msg: err instanceof Error ? err.message : '连接失败' });
    } finally {
      setBotTesting(false);
    }
  };

  function maskToken(token: string | undefined): string {
    if (!token) return '';
    return '*'.repeat(token.length);
  }

  function isMaskedSecret(value: string | undefined): boolean {
    return Boolean(value && /^\*+$/.test(value));
  }

  function isUsableSecret(value: string | undefined): value is string {
    return Boolean(value && value.trim() && !isMaskedSecret(value));
  }

  function sanitizeCredentialsForSave(credentials: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!credentials) return undefined;
    const entries = Object.entries(credentials).filter(([, value]) => isUsableSecret(value));
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function sanitizeBotForSave(bot: BotConfig): BotConfig {
    const cleaned = {
      ...bot,
      credentials: sanitizeCredentialsForSave(bot.credentials),
      authToken: isUsableSecret(bot.authToken) ? bot.authToken : undefined,
    };
    if (cleaned.channel === 'web') {
      delete cleaned.groupReplyMode;
    }
    return cleaned;
  }

  const credFields: Record<Channel, Array<{ key: string; label: string; placeholder: string }>> = {
    feishu: [
      { key: 'appId', label: 'App ID', placeholder: '输入飞书 App ID' },
      { key: 'appSecret', label: 'App Secret', placeholder: '输入飞书 App Secret' },
    ],
    dingtalk: [
      { key: 'clientId', label: 'Client ID', placeholder: '输入钉钉 Client ID' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: '输入钉钉 Client Secret' },
    ],
    web: [],
  };

  const webEntryBots = config.bots.filter((bot) => bot.channel === 'web');
  const imBotEntries = config.bots
    .map((bot, index) => ({ bot, index }))
    .filter(({ bot }) => bot.channel === 'dingtalk' || bot.channel === 'feishu');

  if (loading && !config) {
    return <div style={loadingState}>加载配置中...</div>;
  }

  return (
    <div style={container}>
      <h2 style={heading}>配置</h2>
      <p style={subtitle}>管理模型接入和 Bot 配置。所有修改立即生效。</p>

      {error && <div style={errorBanner}>{error}</div>}
      {success && <div style={successBanner}>配置保存成功</div>}

      {/* Model Config Section */}
      <section style={section}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>模型配置</h3>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} style={btnText}>
              编辑
            </button>
          )}
        </div>

        <div style={configCard}>
          {editing ? (
            <div style={formContainer}>
              {/* Mode toggle */}
              <div style={modeToggle}>
                <button
                  type="button"
                  onClick={() => { setConfig({ ...config, providerMode: 'third_party' }); }}
                  style={{
                    ...modeTab,
                    ...(config.providerMode === 'third_party' ? modeTabActive : {}),
                  }}
                >
                  第三方渠道
                </button>
                <button
                  type="button"
                  onClick={() => { setConfig({ ...config, providerMode: 'official' }); }}
                  style={{
                    ...modeTab,
                    ...(config.providerMode === 'official' ? modeTabActive : {}),
                  }}
                >
                  官方渠道
                </button>
              </div>

              {config.providerMode === 'official' ? (
                <label style={label}>
                  Anthropic API Key
                  <div style={secretInputRow}>
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={isMaskedSecret(config.apiKey) ? '' : config.apiKey || ''}
                      onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                      placeholder={isMaskedSecret(config.apiKey) ? '已配置，留空保留现有 API Key' : 'sk-ant-api03-...'}
                      style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
                    />
                    <button
                      type="button"
                      onClick={() => { void toggleApiKeyVisibility(); }}
                      disabled={!config.apiKey || revealingSecrets}
                      style={secretToggleButton}
                      title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    >
                      {revealingSecrets ? '加载...' : showApiKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  {isMaskedSecret(config.apiKey) && (
                    <span style={helpText}>现有 API Key 已由后端隐藏；留空会保留原值，输入新值后可切换显示/隐藏。</span>
                  )}
                </label>
              ) : (
                <>
                  <div style={infoBox}>
                    <span style={infoIcon}>i</span>
                    <span style={infoText}>使用 Auth Token 进行鉴权，无需 API Key。</span>
                  </div>
                  <label style={label}>
                    Base URL（必填）
                    <input
                      value={config.baseUrl || ''}
                      onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                      placeholder="https://your-relay.example.com/v1"
                      style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
                    />
                  </label>
                  <label style={label}>
                    Auth Token（必填）
                    <div style={secretInputRow}>
                      <input
                        type={showAuthToken ? 'text' : 'password'}
                        value={isMaskedSecret(config.authToken) ? '' : config.authToken || ''}
                        onChange={(e) => { setConfig({ ...config, authToken: e.target.value }); setTestResult(null); }}
                        placeholder={isMaskedSecret(config.authToken) ? '已配置，留空保留现有 Token' : '输入第三方网关 Token'}
                        style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
                      />
                      <button
                        type="button"
                        onClick={() => { void toggleAuthTokenVisibility(); }}
                        disabled={!config.authToken || revealingSecrets}
                        style={secretToggleButton}
                        title={showAuthToken ? '隐藏 Token' : '显示 Token'}
                      >
                        {revealingSecrets ? '加载...' : showAuthToken ? '隐藏' : '显示'}
                      </button>
                    </div>
                    {isMaskedSecret(config.authToken) && (
                      <span style={helpText}>现有 Token 已由后端隐藏；留空会保留原值，输入新值后可切换显示/隐藏。</span>
                    )}
                  </label>
                  <label style={label}>
                    模型名称（可选）
                    <input
                      value={config.model || ''}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
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
              )}
            </div>
          ) : (
            <div style={readOnlyContainer}>
              <div style={configRow}>
                <span style={configKey}>渠道类型</span>
                <span style={configValue}>{config.providerMode === 'official' ? '官方渠道' : '第三方渠道'}</span>
              </div>
              {config.providerMode === 'official' ? (
                <div style={configRow}>
                  <span style={configKey}>API Key</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                    {config.apiKey
                      ? (showApiKey && !isMaskedSecret(config.apiKey) ? config.apiKey : maskToken(config.apiKey))
                      : '(未配置)'}
                    {config.apiKey && (
                      <button
                        type="button"
                        onClick={() => { void toggleApiKeyVisibility(); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', lineHeight: 1, color: 'var(--color-on-dark-soft)', fontFamily: 'var(--font-body)' }}
                        title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                      >
                        {revealingSecrets ? '加载...' : showApiKey ? '隐藏' : '显示'}
                      </button>
                    )}
                  </span>
                </div>
              ) : (
                <>
                  <div style={configRow}>
                    <span style={configKey}>Base URL</span>
                    <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                      {config.baseUrl || '(未配置)'}
                    </span>
                  </div>
                  <div style={configRow}>
                    <span style={configKey}>Auth Token</span>
                    <span style={{ ...configValue, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {config.authToken
                        ? (showAuthToken ? config.authToken : maskToken(config.authToken))
                        : '(未配置)'}
                      {config.authToken && (
                        <button
                          type="button"
                          onClick={() => { void toggleAuthTokenVisibility(); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', lineHeight: 1, color: 'var(--color-on-dark-soft)', fontFamily: 'var(--font-body)' }}
                          title={showAuthToken ? '隐藏 Token' : '显示 Token'}
                        >
                          {revealingSecrets ? '加载...' : showAuthToken ? '隐藏' : '显示'}
                        </button>
                      )}
                    </span>
                  </div>
                  <div style={configRow}>
                    <span style={configKey}>默认模型</span>
                    <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                      {config.model || '(默认)'}
                    </span>
                  </div>
                  <div style={configRow}>
                    <span style={configKey}></span>
                    <button
                      type="button"
                      disabled={testing}
                      onClick={async () => {
                        setTesting(true);
                        setTestResult(null);
                        try {
                          const testConfig = await getConfigForModelTest();
                          if (!testConfig) {
                            setTestResult({ ok: false, msg: '读取明文 Token 失败' });
                            return;
                          }
                          const res = await api.verifyModel({
                            baseUrl: testConfig.baseUrl!,
                            authToken: testConfig.authToken!,
                            model: testConfig.model || undefined,
                          });
                          setTestResult({ ok: res.ok, msg: res.ok ? `连接成功 (${res.model || 'ok'})` : (res.error || '连接失败') });
                        } catch (err: unknown) {
                          setTestResult({ ok: false, msg: err instanceof Error ? err.message : '连接失败' });
                        } finally {
                          setTesting(false);
                        }
                      }}
                      style={btnSecondary}
                    >
                      {testing ? '测试中...' : '测试连接'}
                    </button>
                    {testResult && (
                      <span style={{ fontSize: '13px', marginLeft: '12px', color: testResult.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {testResult.ok ? '✅ ' : '❌ '}{testResult.msg}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {editing && (
          <div style={actionBar}>
            <button type="button" onClick={() => { setEditing(false); loadConfig(); }} style={btnSecondary}>
              取消
            </button>
            <button type="button" onClick={handleSave} disabled={loading} style={btnPrimary}>
              {loading ? '保存中...' : '保存配置'}
            </button>
          </div>
        )}
      </section>

      {/* Web Entry Section */}
      <section style={section}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>Web 入口</h3>
          {!editingWebChat && (
            <button type="button" onClick={() => setEditingWebChat(true)} style={btnText}>
              编辑 Web Chat
            </button>
          )}
        </div>

        <div style={configCard}>
          <div style={botsList}>
            {webEntryBots.length === 0 ? (
              <div style={emptyState}>
                <p style={emptyText}>未配置 Web Chat 入口</p>
              </div>
            ) : (
              webEntryBots.map((bot) => (
                <div key={bot.name} style={botBlock}>
                  <div style={botHeader}>
                    <div>
                      <span style={botName}>{bot.displayName || bot.name}</span>
                      <span style={botMeta}>Web · {bot.name}</span>
                    </div>
                  </div>
                  <div style={configRow}>
                    <span style={configKey}>用途</span>
                    <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                      Web Chat / 后台网页入口
                    </span>
                  </div>
                  {bot.routingMode === 'employee-director' && (
                    <div style={configRow}>
                      <span style={configKey}>路由</span>
                      <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                        {bot.tenant || '-'} · 企业员工调度
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={{ ...formContainer, borderTop: '1px solid var(--color-border-soft)' }}>
            <h4 style={subsectionTitle}>Web Chat 配置</h4>
            {editingWebChat ? (
              <>
                <label style={label}>
                  欢迎标题
                  <input
                    value={config.webChat.welcomeTitle}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, welcomeTitle: e.target.value },
                    })}
                    style={input}
                  />
                </label>
                <label style={label}>
                  欢迎副标题
                  <input
                    value={config.webChat.welcomeSubtitle}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, welcomeSubtitle: e.target.value },
                    })}
                    style={input}
                  />
                </label>
                <label style={label}>
                  输入框提示
                  <input
                    value={config.webChat.inputPlaceholder}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, inputPlaceholder: e.target.value },
                    })}
                    style={input}
                  />
                </label>
                <label style={label}>
                  历史加载条数
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={config.webChat.historyLimit}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: {
                        ...config.webChat,
                        historyLimit: Math.max(10, Math.min(200, Number(e.target.value) || 50)),
                      },
                    })}
                    style={input}
                  />
                </label>
                <label style={checkboxRow}>
                  <input
                    type="checkbox"
                    checked={config.webChat.enableImageUpload}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, enableImageUpload: e.target.checked },
                    })}
                  />
                  允许图片上传
                </label>
                <label style={checkboxRow}>
                  <input
                    type="checkbox"
                    checked={config.webChat.showSessionPicker}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, showSessionPicker: e.target.checked },
                    })}
                  />
                  显示会话选择
                </label>
                <label style={checkboxRow}>
                  <input
                    type="checkbox"
                    checked={config.webChat.showQuickPrompts}
                    onChange={(e) => setConfig({
                      ...config,
                      webChat: { ...config.webChat, showQuickPrompts: e.target.checked },
                    })}
                  />
                  显示快捷提示
                </label>
                <div style={formActions}>
                  <button type="button" onClick={() => { setEditingWebChat(false); loadConfig(); }} style={btnSecondary}>
                    取消
                  </button>
                  <button type="button" onClick={() => { void handleSaveWebChat(); }} disabled={loading} style={btnPrimary}>
                    {loading ? '保存中...' : '保存 Web Chat'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={configRow}>
                  <span style={configKey}>欢迎</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                    {config.webChat.welcomeTitle}
                  </span>
                </div>
                <div style={configRow}>
                  <span style={configKey}>输入</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                    {config.webChat.inputPlaceholder}
                  </span>
                </div>
                <div style={configRow}>
                  <span style={configKey}>历史</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                    {config.webChat.historyLimit} 条
                  </span>
                </div>
                <div style={configRow}>
                  <span style={configKey}>功能</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                    图片 {config.webChat.enableImageUpload ? '开' : '关'} · 会话 {config.webChat.showSessionPicker ? '开' : '关'} · 快捷提示 {config.webChat.showQuickPrompts ? '开' : '关'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* IM Bot Management Section */}
      <section style={section}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>IM Bot 管理</h3>
          {!addingBot && editingBotIndex === null && (
            <button type="button" onClick={handleAddBot} style={btnPrimary}>
              + 添加 Bot
            </button>
          )}
        </div>

        <div style={configCard}>
          {addingBot || editingBotIndex !== null ? (
            <div style={formContainer}>
              {editingBotIndex !== null && (
                <div style={configRow}>
                  <span style={configKey}>内部 ID</span>
                  <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>{botForm.name}</span>
                </div>
              )}

              <label style={label}>
                显示名称
                <input
                  value={botForm.displayName || ''}
                  onChange={(e) => setBotForm({ ...botForm, displayName: e.target.value })}
                  placeholder="例如：我的助手"
                  style={input}
                />
              </label>

              <label style={label}>
                通道
                <div style={channelTabs}>
                  {(['dingtalk', 'feishu'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => { setBotForm({ ...botForm, channel: ch, credentials: {} }); setBotTestResult(null); }}
                      style={{
                        ...channelTab,
                        ...(botForm.channel === ch ? channelTabActive : {}),
                      }}
                    >
                      {ch === 'dingtalk' ? '钉钉' : '飞书'}
                    </button>
                  ))}
                </div>
              </label>

              {botForm.channel && credFields[botForm.channel as Channel].map(({ key, label: fieldLabel, placeholder }: { key: string; label: string; placeholder: string }) => (
                <label key={key} style={label}>
                  {fieldLabel}
                  <input
                    type="password"
                    value={isMaskedSecret(botForm.credentials?.[key]) ? '' : botForm.credentials?.[key] || ''}
                    onChange={(e) => setBotForm({
                      ...botForm,
                      credentials: { ...botForm.credentials, [key]: e.target.value },
                    })}
                    onInput={() => setBotTestResult(null)}
                    placeholder={isMaskedSecret(botForm.credentials?.[key]) ? '已配置，留空保留原值' : placeholder}
                    style={input}
                  />
                </label>
              ))}

              <div style={testRow}>
                <button
                  type="button"
                  onClick={() => { void handleTestBot(); }}
                  disabled={botTesting || !botForm.channel || botForm.channel === 'dingtalk'}
                  style={btnSecondary}
                  title={botForm.channel === 'dingtalk' ? '钉钉连通性测试暂未实现' : '测试 Bot 凭据是否能连接平台'}
                >
                  {botTesting ? '测试中...' : '测试连接'}
                </button>
                {botTestResult && (
                  <span style={{ fontSize: '13px', color: botTestResult.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {botTestResult.ok ? 'OK ' : 'ERR '}{botTestResult.msg}
                  </span>
                )}
              </div>

              <label style={label}>
                路由模式
                <select
                  value={botForm.routingMode || 'direct'}
                  onChange={(e) => setBotForm({
                    ...botForm,
                    routingMode: e.target.value as BotConfig['routingMode'],
                  })}
                  style={input}
                >
                  <option value="direct">普通 Bot</option>
                  <option value="employee-director">企业员工调度</option>
                </select>
                <span style={helpText}>
                  企业员工调度入口只负责接入 IM 和按人员分发；数字员工在各自 workspace 中运行，入口不会切到某个员工目录。
                </span>
              </label>

              <label style={label}>
                群聊响应模式
                <select
                  value={botForm.groupReplyMode || 'mention-only'}
                  onChange={(e) => setBotForm({
                    ...botForm,
                    groupReplyMode: e.target.value as BotConfig['groupReplyMode'],
                  })}
                  style={input}
                >
                  <option value="mention-only">只回复 @ 消息</option>
                  <option value="all">回复所有群消息</option>
                </select>
                <span style={helpText}>
                  私聊始终回复；群聊默认只在 @ 当前 Bot 时回复，切到所有群消息后会处理群里每条消息。
                </span>
              </label>

              {botForm.routingMode === 'employee-director' && (
                <>
                  <label style={label}>
                    企业租户
                    <select
                      value={botForm.tenant || ''}
                      onChange={(e) => setBotForm({ ...botForm, tenant: e.target.value })}
                      style={input}
                    >
                      <option value="">选择租户</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>{t.displayName || t.id}</option>
                      ))}
                    </select>
                    <span style={helpText}>
                      该租户下的员工 YAML 决定员工 workspace；人员绑定页决定每个人可进入哪些数字员工。
                    </span>
                  </label>

                </>
              )}

              <div style={formActions}>
                <button type="button" onClick={() => { setAddingBot(false); setEditingBotIndex(null); }} style={btnSecondary}>
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSaveBot(); }}
                  disabled={editingBotIndex !== null && !botForm.name.trim()}
                  style={btnPrimary}
                >
                  {editingBotIndex !== null ? '保存修改' : '添加 Bot'}
                </button>
              </div>
            </div>
          ) : (
            <div style={botsList}>
              {imBotEntries.length === 0 ? (
                <div style={emptyState}>
                  <p style={emptyText}>暂无 IM Bot，点击上方按钮添加</p>
                </div>
              ) : (
                imBotEntries.map(({ bot, index }) => (
                  <div key={index} style={botBlock}>
                    <div style={botHeader}>
                      <div>
                        <span style={botName}>{bot.displayName || bot.name}</span>
                        <span style={botMeta}>
                          {bot.channel === 'dingtalk' ? '钉钉' : bot.channel === 'web' ? 'Web' : '飞书'} · {bot.name}
                        </span>
                      </div>
                      <div style={botActions}>
                        <button type="button" onClick={() => handleEditBot(index)} style={btnIcon}>
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDeleteBot(index); }}
                          title="删除 Bot"
                          style={{
                            ...btnIcon,
                            color: '#f87171',
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {bot.model && (
                      <div style={configRow}>
                        <span style={configKey}>模型</span>
                        <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>{bot.model}</span>
                      </div>
                    )}
                    {bot.routingMode === 'employee-director' && (
                      <div style={configRow}>
                        <span style={configKey}>路由</span>
                        <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                          {bot.tenant || '-'} · 企业员工调度 · 员工 workspace 隔离
                        </span>
                      </div>
                    )}
                    <div style={configRow}>
                      <span style={configKey}>群聊</span>
                      <span style={{ ...configValue, fontFamily: 'var(--font-mono)' }}>
                        {(bot.groupReplyMode || 'mention-only') === 'all' ? '回复所有群消息' : '只回复 @ 消息'}
                      </span>
                    </div>
                    {bot.credentials && Object.keys(bot.credentials).length > 0 && (
                      <div style={configRow}>
                        <span style={configKey}>凭据</span>
                        <span style={{ ...configValue, color: 'var(--color-on-dark-soft)', fontFamily: 'var(--font-mono)' }}>
                          {Object.entries(bot.credentials).map(([k, v]) => `${k}=${maskToken(v)}`).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ── Layout styles ───────────────────────────────────────── */

const container: React.CSSProperties = {
  maxWidth: '1000px',
  margin: '0 auto',
  padding: '48px 24px',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '32px',
  fontWeight: 700,
  color: 'var(--color-on-dark)',
  fontFamily: 'var(--font-display)',
};

const subtitle: React.CSSProperties = {
  margin: '8px 0 32px',
  fontSize: '14px',
  color: 'var(--color-on-dark-soft)',
};

const helpText: React.CSSProperties = {
  marginTop: '6px',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--color-on-dark-soft)',
};

const section: React.CSSProperties = {
  marginBottom: '32px',
};

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const subsectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const configCard: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border, var(--color-surface-dark-elevated))',
  overflow: 'hidden',
};

const readOnlyContainer: React.CSSProperties = {
  padding: '16px 20px',
};

const configRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 0',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
};

const configKey: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
  textTransform: 'uppercase',
  letterSpacing: '1px',
};

const configValue: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--color-on-dark)',
};

const formContainer: React.CSSProperties = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
};

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
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

const secretInputRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: '8px',
  alignItems: 'center',
};

const secretToggleButton: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  minWidth: '64px',
};

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

const formActions: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
  marginTop: '8px',
};

const testRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const actionBar: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
  marginTop: '16px',
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
};

const btnText: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-accent)',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const btnIcon: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const botsList: React.CSSProperties = {
  padding: '8px',
};

const botBlock: React.CSSProperties = {
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
  marginBottom: '8px',
};

const botHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '12px',
};

const botName: React.CSSProperties = {
  display: 'block',
  fontSize: '15px',
  fontWeight: 500,
  color: 'var(--color-on-dark)',
  marginBottom: '4px',
};

const botMeta: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  fontFamily: 'var(--font-mono)',
};

const botActions: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
};

const emptyState: React.CSSProperties = {
  padding: '32px',
  textAlign: 'center',
  color: 'var(--color-on-dark-soft)',
};

const emptyText: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
};

const loadingState: React.CSSProperties = {
  padding: '48px',
  textAlign: 'center',
  color: 'var(--color-on-dark-soft)',
};

const errorBanner: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
  fontSize: '14px',
  marginBottom: '16px',
};

const successBanner: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(34, 197, 94, 0.08)',
  border: '1px solid rgba(34, 197, 94, 0.25)',
  color: '#22c55e',
  fontSize: '14px',
  marginBottom: '16px',
};
