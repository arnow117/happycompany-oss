import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { clearToken } from '../lib/auth';
import {
  LogOut, PanelLeftClose, PanelLeftOpen, Plus, Sun, Moon, Menu, X,
  MessageSquare, ClipboardList, Network, BookOpen, Wrench, Users,
  Contact, Package, LayoutDashboard, Settings, Brain, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { TenantSwitcher } from './chat/TenantSwitcher';
import { OnboardingBanner } from './OnboardingBanner';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  tier?: 'production' | 'build' | 'preview' | 'ops';
}

interface NavGroup {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: '日常工作',
    items: [
      { to: '/chat', label: '对话', icon: MessageSquare, tier: 'production' },
      { to: '/sessions', label: '会话', icon: ClipboardList, tier: 'production' },
      { to: '/orchestration', label: '多员工工作流', icon: Network, tier: 'production' },
      { to: '/knowledge', label: '知识库', icon: BookOpen, tier: 'production' },
    ],
  },
  {
    title: '员工与能力',
    items: [
      { to: '/agent-builder', label: '员工 Builder', icon: Wrench, tier: 'build' },
      { to: '/employees', label: '数字员工', icon: Users, tier: 'build' },
      { to: '/people', label: '企业员工', icon: Contact, tier: 'build' },
      { to: '/skills-marketplace', label: '技能市场', icon: Package, tier: 'build' },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/', label: '概览', icon: LayoutDashboard, tier: 'ops' },
      { to: '/config', label: '配置', icon: Settings, tier: 'ops' },
      { to: '/memory', label: '记忆', icon: Brain, tier: 'ops' },
      { to: '/harness', label: '验收', icon: ShieldCheck, tier: 'ops' },
    ],
  },
] as const;

const EXACT_MATCH = new Set(['/', '/chat']);

type Theme = 'light' | 'dark' | null;
type BackendStatus = 'checking' | 'online' | 'offline';

/* Tier badges are now reserved for EXCEPTIONS only (e.g. preview / coming-soon).
   The group titles already convey 日常工作 / 员工与能力 / 系统, so badging every
   item just added noise. Mark an item `tier: 'preview'` to surface its badge. */
function tierLabel(tier?: NavItem['tier']): string | null {
  if (tier === 'preview') return '预览';
  return null;
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved === 'light' || saved === 'dark') return saved;
  return getSystemTheme();
}

function getInitialCollapsed(): boolean {
  return localStorage.getItem('sidebarCollapsed') === 'true';
}

function backendStatusLabel(status: BackendStatus): string {
  if (status === 'online') return '后端可用';
  if (status === 'offline') return '后端不可用';
  return '检测后端中';
}

function backendStatusColor(status: BackendStatus): string {
  if (status === 'online') return 'var(--color-success)';
  if (status === 'offline') return 'var(--color-danger)';
  return 'var(--color-warning)';
}

interface LayoutProps {
  needsSetup: boolean;
}

export function Layout({ needsSetup }: LayoutProps) {
  const location = useLocation();
  const isChat = location.pathname.startsWith('/chat');
  const isFullHeight = isChat;
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [backendCheckedAt, setBackendCheckedAt] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const s = new Set<string>();
    NAV_GROUPS.forEach((g) => { if (g.defaultOpen === false) s.add(g.title); });
    return s;
  });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function checkBackend() {
      try {
        const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
        if (cancelled) return;
        setBackendStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (cancelled) return;
        setBackendStatus('offline');
      } finally {
        if (!cancelled) setBackendCheckedAt(Date.now());
      }
    }

    void checkBackend();
    const timer = window.setInterval(() => {
      void checkBackend();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const toggleCollapsed = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('sidebarCollapsed', String(next));
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <div style={isFullHeight ? { ...shell, height: '100dvh' } : shell}>
      {isMobile && (
        <header style={mobileHeader}>
          <button
            onClick={() => setSidebarOpen(true)}
            style={menuButton}
            aria-label="Open menu"
          >
            <Menu size={20} color="var(--color-on-dark)" />
          </button>
          <div style={mobileBrand}>
            <h1 style={mobileBrandTitle}>HappyCompany</h1>
          </div>
        </header>
      )}

      <aside style={{
        ...sidebar,
        width: sidebarCollapsed ? '56px' : '240px',
        ...(isMobile ? { ...sidebarMobile, ...(sidebarOpen ? { transform: 'translateX(0)' } : {}) } : sidebarDesktop),
        ...(isMobile && !sidebarOpen ? { display: 'none' } : {}),
      }}>
        <div style={sidebarCollapsed ? brandCollapsed : brand}>
          {sidebarCollapsed ? (
            <>
              <h1 style={brandTitleCollapsed}>HC</h1>
              {!isMobile && (
                <button onClick={toggleCollapsed} style={topIconButton} aria-label="展开侧边栏" title="展开侧边栏">
                  <PanelLeftOpen size={15} color="var(--color-on-dark-soft)" />
                </button>
              )}
            </>
          ) : (
            <>
              <h1 style={brandTitle}>HappyCompany</h1>
              {!isMobile && (
                <button onClick={toggleCollapsed} style={topIconButton} aria-label="收起侧边栏" title="收起侧边栏">
                  <PanelLeftClose size={16} color="var(--color-on-dark-soft)" />
                </button>
              )}
            </>
          )}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(false)}
              style={closeButton}
              aria-label="Close menu"
            >
              <X size={18} color="var(--color-on-dark-soft)" />
            </button>
          )}
        </div>

        {!sidebarCollapsed && <TenantSwitcher />}

        <nav style={sidebarCollapsed ? navCollapsed : nav}>
          {NAV_GROUPS.map((group) => {
            const isGroupCollapsed = collapsedGroups.has(group.title);
            return (
            <div key={group.title} style={groupContainer}>
              {!sidebarCollapsed && (
                <div
                  style={{ ...groupTitle, cursor: group.defaultOpen === false ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (group.defaultOpen !== false) return;
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.title)) next.delete(group.title);
                      else next.add(group.title);
                      return next;
                    });
                  }}
                >
                  {group.title}
                  {group.defaultOpen === false && (
                    <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.5 }}>{isGroupCollapsed ? '▸' : '▾'}</span>
                  )}
                </div>
              )}
              {sidebarCollapsed ? (
                group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={EXACT_MATCH.has(item.to)}
                    style={({ isActive }) => ({
                      display: 'flex',
                      justifyContent: 'center',
                      padding: '8px 0',
                      borderRadius: 'var(--radius-sm)',
                      lineHeight: 1,
                      textDecoration: 'none',
                      color: isActive ? 'var(--color-on-dark)' : 'var(--color-on-dark-soft)',
                      background: isActive ? 'var(--color-surface-dark-elevated)' : 'transparent',
                      opacity: isActive ? 1 : 0.65,
                      transition: 'all var(--transition-fast) var(--ease-out-expo)',
                    })}
                    onClick={() => isMobile && setSidebarOpen(false)}
                    title={item.label}
                  >
                    <Icon size={18} strokeWidth={1.6} />
                  </NavLink>
                  );
                })
              ) : !isGroupCollapsed && group.items.map((item) => {
                const Icon = item.icon;
                const badge = tierLabel(item.tier);
                return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={EXACT_MATCH.has(item.to)}
                  style={({ isActive }) => ({
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '6px 12px 6px 18px',
                    margin: '0 0 1px 0',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: isActive ? 500 : 400,
                    fontFamily: 'var(--font-body)',
                    color: isActive
                      ? 'var(--color-on-dark)'
                      : 'var(--color-on-dark-soft)',
                    background: isActive
                      ? 'var(--color-surface-dark-elevated)'
                      : 'transparent',
                    transition: 'all var(--transition-fast) var(--ease-out-expo)',
                    textDecoration: 'none',
                  })}
                  onClick={() => isMobile && setSidebarOpen(false)}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span style={activeBar} />}
                      <span style={navLabelGroup}>
                        <Icon size={16} strokeWidth={1.6} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }} />
                        <span style={navLabel}>{item.label}</span>
                      </span>
                      {badge && <span style={tierBadge}>{badge}</span>}
                    </>
                  )}
                </NavLink>
                );
              })}
            </div>
          )})}
          {needsSetup && !sidebarCollapsed && (
            <NavLink
              to="/model-config"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px 6px 18px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                fontWeight: isActive ? 500 : 600,
                fontFamily: 'var(--font-body)',
                color: 'var(--color-accent)',
                background: isActive
                  ? 'var(--color-surface-dark-elevated)'
                  : 'transparent',
                transition: 'all var(--transition-fast) var(--ease-out-expo)',
                textDecoration: 'none',
              })}
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <Settings size={16} strokeWidth={1.6} style={{ flexShrink: 0 }} />
              <span>模型配置</span>
            </NavLink>
          )}
        </nav>

        {!sidebarCollapsed && (
          <NavLink
            to="/onboarding"
            style={({ isActive }) => ({
              ...newTenantLink,
              background: isActive ? 'var(--color-surface-dark-elevated)' : 'transparent',
              color: isActive ? 'var(--color-on-dark)' : 'var(--color-on-dark-soft)',
            })}
            onClick={() => isMobile && setSidebarOpen(false)}
          >
            <Plus size={14} />
            <span>新建企业</span>
          </NavLink>
        )}

        {sidebarCollapsed ? (
          <div style={versionCollapsed}>
            <BackendStatusDot status={backendStatus} checkedAt={backendCheckedAt} collapsed />
          </div>
        ) : (
          <div style={version}>
            <div style={footerMeta}>
              <BackendStatusDot status={backendStatus} checkedAt={backendCheckedAt} />
              <span style={versionText}>v0.1.0</span>
            </div>
            <div style={footerActions}>
              <button onClick={toggleTheme} style={footerIconButton} aria-label="Toggle theme" title="切换主题">
                {theme === 'dark' ? <Sun size={15} color="var(--color-on-dark-soft)" /> : <Moon size={15} color="var(--color-on-dark-soft)" />}
              </button>
              <button onClick={() => { clearToken(); window.location.href = '/login'; }} style={footerIconButton} aria-label="Logout" title="Logout">
                <LogOut size={15} color="var(--color-on-dark-soft)" />
              </button>
            </div>
          </div>
          )}
      </aside>

      {isMobile && sidebarOpen && (
        <div
          style={overlay}
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <main style={isFullHeight ? chatMain : main}>
        <OnboardingBanner isFullHeight={isFullHeight} />
        <div style={isFullHeight ? chatContainer : container}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function BackendStatusDot(props: { status: BackendStatus; checkedAt: number | null; collapsed?: boolean }) {
  const label = backendStatusLabel(props.status);
  const checkedText = props.checkedAt ? ` · ${new Date(props.checkedAt).toLocaleTimeString()}` : '';
  return (
    <div
      aria-label={label}
      title={`${label}${checkedText}`}
      style={props.collapsed ? backendStatusCollapsed : backendStatusRow}
    >
      <span style={{ ...backendStatusDot, background: backendStatusColor(props.status) }} />
      {!props.collapsed && <span style={backendStatusText}>{label}</span>}
    </div>
  );
}

const shell: React.CSSProperties = {
  display: 'flex',
  height: '100vh',
  overflow: 'hidden',
  background: 'var(--color-bg-deep)',
};

const sidebar: React.CSSProperties = {
  width: '240px',
  flexShrink: 0,
  background: 'var(--color-surface-dark)',
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 0 12px',
  color: 'var(--color-on-dark)',
  position: 'relative',
  height: '100vh',
  overflow: 'hidden',
};

const sidebarDesktop: React.CSSProperties = {
  position: 'static',
};

const sidebarMobile: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  zIndex: 100,
  transform: 'translateX(-100%)',
  transition: 'transform var(--transition-normal) var(--ease-out-expo)',
  willChange: 'transform',
};

const overlay: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 90,
  opacity: 1,
  transition: 'opacity var(--transition-normal) var(--ease-out-expo)',
};

const mobileHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '12px 16px',
  background: 'var(--color-surface-dark)',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
};

const menuButton: React.CSSProperties = {
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

const mobileBrand: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const mobileBrandTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  fontWeight: 400,
  fontFamily: 'var(--font-display)',
  color: 'var(--color-on-dark)',
  letterSpacing: '-0.02em',
};

const brand: React.CSSProperties = {
  padding: '0 14px 18px 24px',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
  marginBottom: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
};

const closeButton: React.CSSProperties = {
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

const brandTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 400,
  fontFamily: 'var(--font-display)',
  letterSpacing: '-0.02em',
  color: 'var(--color-on-dark)',
};

const nav: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '0 12px',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const groupContainer: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const groupTitle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '1.5px',
  padding: '10px 12px 4px',
  display: 'flex',
  alignItems: 'center',
  userSelect: 'none',
  flexShrink: 0,
};

const navLabelGroup: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const navLabel: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const activeBar: React.CSSProperties = {
  position: 'absolute',
  left: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 3,
  height: 16,
  borderRadius: 2,
  background: 'var(--color-accent)',
};

const tierBadge: React.CSSProperties = {
  flexShrink: 0,
  padding: '1px 7px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-warning-dim)',
  color: 'var(--color-warning)',
  fontSize: '10px',
  fontWeight: 500,
  lineHeight: 1.4,
};

const version: React.CSSProperties = {
  marginTop: 'auto',
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  flexShrink: 0,
};

const footerMeta: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const footerActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
};

const backendStatusRow: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  minHeight: 20,
  padding: '2px 0',
  color: 'var(--color-on-dark-soft)',
  fontSize: '12px',
  fontFamily: 'var(--font-body)',
};

const backendStatusCollapsed: React.CSSProperties = {
  width: 28,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const backendStatusDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '999px',
  boxShadow: '0 0 0 3px rgba(255, 255, 255, 0.08)',
  flexShrink: 0,
};

const backendStatusText: React.CSSProperties = {
  color: 'var(--color-on-dark-soft)',
  whiteSpace: 'nowrap',
};

const newTenantLink: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: '8px 12px 10px',
  padding: '7px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  textDecoration: 'none',
  transition: 'all var(--transition-fast) var(--ease-out-expo)',
};

const brandCollapsed: React.CSSProperties = {
  padding: '0 6px 12px',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
  marginBottom: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  alignItems: 'center',
  justifyContent: 'center',
};
const brandTitleCollapsed: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
  fontFamily: 'var(--font-display)',
  letterSpacing: '-0.02em',
  color: 'var(--color-on-dark)',
};
const navCollapsed: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '0 8px',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};
const versionCollapsed: React.CSSProperties = {
  marginTop: 'auto',
  padding: '0 4px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  alignItems: 'center',
  flexShrink: 0,
};

const topIconButton: React.CSSProperties = {
  width: 26,
  height: 26,
  background: 'none',
  border: 'none',
  color: 'var(--color-on-dark-soft)',
  cursor: 'pointer',
  padding: 0,
  borderRadius: 'var(--radius-sm)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'all var(--transition-fast) var(--ease-out-expo)',
};

const versionText: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--color-on-dark-soft)',
  fontFamily: 'var(--font-mono)',
};

const footerIconButton: React.CSSProperties = {
  width: 24,
  height: 24,
  background: 'none',
  border: 'none',
  color: 'var(--color-on-dark-soft)',
  fontSize: '11px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  padding: 0,
  borderRadius: 'var(--radius-sm)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all var(--transition-fast) var(--ease-out-expo)',
};

const main: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
  background: 'var(--color-bg-deep)',
};

const container: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '48px 24px',
};

const chatMain: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--color-bg-deep)',
};

const chatContainer: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
