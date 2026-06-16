import { useEffect, useState } from 'react';
import { ArrowRight, Bot, Cable, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

export function Login() {
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [compact, setCompact] = useState(() => window.innerWidth < 900);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('请输入管理员访问令牌');
      return;
    }
    setLoading(true);
    try {
      await api.login(token.trim());
      setToken(token.trim(), remember);
      navigate(from, { replace: true });
    } catch {
      setError('管理员令牌无效或已过期');
    } finally {
      setLoading(false);
    }
  };

  const featureItems = [
    { icon: <Bot size={18} />, title: '搭建员工网络', body: '为销售、客服、运营、财务等岗位配置数字员工，明确职责和可做的事。' },
    { icon: <Cable size={18} />, title: '接入消息入口', body: 'Web、钉钉、飞书里的咨询和内部请求，进入同一个业务工作台。' },
    { icon: <ShieldCheck size={18} />, title: '协作完成任务', body: '一个员工处理不了时，自动交给合适同事，并记录每一步进展。' },
  ];

  const productProof = (
    <>
      <div style={compact ? compactFeatureGrid : featureGrid} aria-label="核心功能">
        {featureItems.map((item) => (
          <div key={item.title} style={featureItem}>
            <div style={featureIcon}>{item.icon}</div>
            <div>
              <h2 style={featureTitle}>{item.title}</h2>
              <p style={featureBody}>{item.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={compact ? compactMetricGrid : metricGrid} aria-label="平台指标">
        <Metric value="多入口" label="统一接入" detail="Web / 钉钉 / 飞书" />
        <Metric value="协作" label="员工网络" detail="路由 / 转交 / 执行" />
        <Metric value="可追踪" label="业务过程" detail="记录 / 复盘 / 验收" />
      </div>
    </>
  );

  return (
    <div style={page}>
      <div style={heroImage} aria-hidden="true" />
      <div style={scrim} aria-hidden="true" />

      <header style={topbar}>
        <div style={brandLockup}>
          <div style={brandMark}>HC</div>
          <div>
            <p style={brandName}>HappyCompany</p>
            <p style={brandMeta}>Digital Employee Platform</p>
          </div>
        </div>
        <span style={environmentBadge}>管理员入口</span>
      </header>

      <main style={compact ? compactContent : content}>
        <section style={intro}>
          <p style={eyebrow}>企业数字员工网络</p>
          <h1 style={compact ? compactTitle : title}>
            让企业消息进入
            <span style={titleHighlight}>数字员工网络</span>
          </h1>
          <p style={subtitle}>
            HappyCompany 把 Web、钉钉、飞书里的消息接到同一张员工网络里。每个请求都会自动找到合适的数字员工，必要时协作转交，并留下可追踪的处理过程。
          </p>

          {!compact && productProof}
        </section>

        <form style={compact ? compactCard : card} onSubmit={handleSubmit}>
          <div style={cardHeader}>
            <p style={cardKicker}>Admin Console</p>
            <h2 style={cardTitle}>管理员登录</h2>
            <p style={cardSubtitle}>使用部署配置中的 Admin Token 进入后台。</p>
          </div>

          <label style={label} htmlFor="admin-token">
            管理员令牌
            <input
              id="admin-token"
              type="password"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Enter admin token"
              style={input}
              autoComplete="current-password"
              autoFocus
            />
          </label>

          <label style={checkboxLabel}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={checkbox}
            />
            <span>在这台设备上保留登录状态</span>
          </label>

          {error && <p role="alert" style={errorStyle}>{error}</p>}

          <button type="submit" style={loading ? disabledButton : button} disabled={loading}>
            <span>{loading ? '正在校验...' : '进入控制台'}</span>
            {!loading && <ArrowRight size={16} aria-hidden="true" />}
          </button>

          <div style={poweredBy}>
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>Powered by Claude Agent SDK</span>
          </div>
        </form>

        {compact && <section style={compactProof}>{productProof}</section>}
      </main>
    </div>
  );
}

function Metric(props: { value: string; label: string; detail: string }) {
  return (
    <div style={metricItem}>
      <span style={metricValue}>{props.value}</span>
      <span style={metricLabel}>{props.label}</span>
      <span style={metricDetail}>{props.detail}</span>
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
  background: '#faf9f5',
  position: 'relative',
  overflow: 'hidden',
};

const heroImage: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage: "url('/assets/hero-digital-employees.png')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  transform: 'scale(1.02)',
};

const scrim: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'linear-gradient(90deg, rgba(250, 249, 245, 0.96) 0%, rgba(245, 240, 232, 0.84) 43%, rgba(245, 240, 232, 0.54) 100%), linear-gradient(180deg, rgba(250, 249, 245, 0.9) 0%, rgba(250, 249, 245, 0.4) 48%, rgba(239, 233, 222, 0.92) 100%)',
};

const topbar: React.CSSProperties = {
  height: '72px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 clamp(20px, 5vw, 64px)',
  position: 'relative',
  zIndex: 1,
};

const brandLockup: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const brandMark: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: 'var(--radius-md)',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255, 252, 247, 0.94)',
  color: '#252523',
  fontSize: '13px',
  fontWeight: 700,
  boxShadow: '0 16px 44px rgba(91, 62, 42, 0.14)',
};

const brandName: React.CSSProperties = {
  margin: 0,
  color: '#252523',
  fontSize: '15px',
  fontWeight: 700,
};

const brandMeta: React.CSSProperties = {
  margin: '1px 0 0',
  color: 'rgba(61, 61, 58, 0.62)',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const environmentBadge: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid rgba(204, 120, 92, 0.22)',
  borderRadius: 'var(--radius-pill)',
  background: 'rgba(255, 252, 247, 0.68)',
  color: '#3d3d3a',
  fontSize: '12px',
  fontWeight: 600,
  backdropFilter: 'blur(12px)',
};

const content: React.CSSProperties = {
  width: 'min(1180px, calc(100vw - 40px))',
  margin: '0 auto',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.12fr) minmax(330px, 408px)',
  gap: '56px',
  alignItems: 'center',
  padding: '30px 0 58px',
  position: 'relative',
  zIndex: 1,
};

const compactContent: React.CSSProperties = {
  ...content,
  width: 'min(560px, calc(100vw - 32px))',
  gridTemplateColumns: '1fr',
  gap: '24px',
  alignItems: 'start',
  padding: '18px 0 40px',
};

const intro: React.CSSProperties = {
  maxWidth: '710px',
};

const eyebrow: React.CSSProperties = {
  margin: '0 0 14px',
  color: '#a9583e',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1px',
};

const title: React.CSSProperties = {
  margin: 0,
  maxWidth: '720px',
  fontSize: '56px',
  lineHeight: 1.05,
  fontWeight: 750,
  fontFamily: 'var(--font-display)',
  color: '#252523',
  letterSpacing: 0,
};

const compactTitle: React.CSSProperties = {
  ...title,
  fontSize: '38px',
  lineHeight: 1.12,
};

const titleHighlight: React.CSSProperties = {
  display: 'block',
  color: '#cc785c',
};

const subtitle: React.CSSProperties = {
  margin: '20px 0 0',
  maxWidth: '640px',
  fontSize: '16px',
  color: 'rgba(61, 61, 58, 0.78)',
  lineHeight: 1.75,
};

const featureGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '10px',
  marginTop: '30px',
};

const compactFeatureGrid: React.CSSProperties = {
  ...featureGrid,
  gridTemplateColumns: '1fr',
  marginTop: '22px',
};

const featureItem: React.CSSProperties = {
  minHeight: '132px',
  padding: '16px',
  border: '1px solid rgba(204, 120, 92, 0.18)',
  borderRadius: 'var(--radius-md)',
  background: 'rgba(255, 252, 247, 0.58)',
  backdropFilter: 'blur(14px)',
};

const featureIcon: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: 'var(--radius-sm)',
  display: 'grid',
  placeItems: 'center',
  color: '#a9583e',
  background: 'rgba(204, 120, 92, 0.14)',
  marginBottom: '12px',
};

const featureTitle: React.CSSProperties = {
  margin: 0,
  color: '#252523',
  fontSize: '15px',
  fontWeight: 700,
};

const featureBody: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'rgba(61, 61, 58, 0.68)',
  fontSize: '13px',
  lineHeight: 1.55,
};

const metricGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '12px',
  marginTop: '18px',
};

const compactMetricGrid: React.CSSProperties = {
  ...metricGrid,
  gridTemplateColumns: '1fr',
};

const metricItem: React.CSSProperties = {
  minHeight: '92px',
  padding: '15px',
  borderTop: '1px solid rgba(204, 120, 92, 0.22)',
  background: 'linear-gradient(180deg, rgba(255, 252, 247, 0.62), rgba(255, 252, 247, 0.28))',
};

const metricValue: React.CSSProperties = {
  display: 'block',
  color: '#252523',
  fontSize: '30px',
  fontWeight: 760,
  lineHeight: 1,
};

const metricLabel: React.CSSProperties = {
  display: 'block',
  marginTop: '8px',
  color: 'rgba(61, 61, 58, 0.86)',
  fontSize: '13px',
  fontWeight: 700,
};

const metricDetail: React.CSSProperties = {
  display: 'block',
  marginTop: '3px',
  color: 'rgba(61, 61, 58, 0.52)',
  fontSize: '12px',
};

const card: React.CSSProperties = {
  background: 'rgba(255, 252, 247, 0.9)',
  border: '1px solid rgba(204, 120, 92, 0.16)',
  borderRadius: 'var(--radius-md)',
  padding: '30px',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  boxShadow: '0 24px 90px rgba(91, 62, 42, 0.18)',
  backdropFilter: 'blur(18px)',
};

const compactCard: React.CSSProperties = {
  ...card,
  padding: '24px',
};

const compactProof: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const cardHeader: React.CSSProperties = {
  marginBottom: '2px',
};

const cardKicker: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-accent-active)',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
};

const cardTitle: React.CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--color-text-strong)',
  fontSize: '24px',
  fontWeight: 700,
};

const cardSubtitle: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--color-text-muted)',
  fontSize: '13px',
  lineHeight: 1.6,
};

const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
};

const input: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '12px',
  fontSize: '14px',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
  outline: 'none',
  boxSizing: 'border-box',
};

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
};

const checkbox: React.CSSProperties = {
  width: '16px',
  height: '16px',
  cursor: 'pointer',
  accentColor: 'var(--color-accent)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: 'var(--color-danger)',
  background: 'var(--color-danger-dim)',
  border: '1px solid rgba(198, 69, 69, 0.25)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
};

const button: React.CSSProperties = {
  marginTop: '2px',
  minHeight: '44px',
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: '#cc785c',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 650,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  opacity: 1,
  transition: 'opacity var(--transition-fast)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
};

const disabledButton: React.CSSProperties = {
  ...button,
  cursor: 'wait',
  opacity: 0.68,
};

const poweredBy: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  minHeight: '20px',
  color: 'var(--color-text-muted)',
  fontSize: '12px',
};
