import { useEffect, useState } from 'react';
import { Settings, MessageSquare, Inbox } from 'lucide-react';
import { api } from '../lib/api';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import type { BotInfo, ChatSummary } from '../lib/api';
import { MetricCard, BotCard, ActionLink, ErrorBlock } from './dashboard/DashboardCards';
import { useWebSocket } from '../hooks/useWebSocket';

export function Dashboard() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { events: liveEvents, connected } = useWebSocket({
    url: `${wsProtocol}//${window.location.host}/api/ws`,
  });

  useEffect(() => {
    Promise.all([api.health(), api.listChats()])
      .then(([health, chatsList]) => {
        setBots(health.bots);
        setChats(chatsList);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, []);

  const totalMessages = chats.reduce((sum, c) => sum + c.messageCount, 0);

  if (loading) {
    return (
      <div className="loading-state">
        <LoadingSkeleton type="card" count={3} />
        <div style={{ marginTop: 24 }}>
          <LoadingSkeleton type="table-row" count={4} />
        </div>
      </div>
    );
  }

  if (error) return <ErrorBlock message={error} />;

  return (
    <section className="page-enter">
      <h2 className="heading">概览</h2>
      <p className="subtitle">系统总览与快速入口。</p>

      <div className="card-grid">
        <MetricCard label="配置入口" value={String(bots.length)} linkTo="/config" icon={<Settings size={15} strokeWidth={2} />} accent />
        <MetricCard label="进行中对话" value={String(chats.length)} linkTo="/sessions" icon={<MessageSquare size={15} strokeWidth={2} />} accent />
        <MetricCard label="消息总数" value={String(totalMessages)} linkTo="/stats" icon={<Inbox size={15} strokeWidth={2} />} />
      </div>

      {bots.length > 0 && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <h3 className="section-title">入口状态</h3>
          <div className="grid-bot-mini">
            {bots.map((bot) => (
              <BotCard key={bot.name} bot={bot} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-xl)' }}>
        <h3 className="section-title">
          实时动态
          <span className={connected ? 'online-badge' : 'offline-badge'} style={{ marginLeft: '8px' }}>
            {connected ? 'live' : 'offline'}
          </span>
        </h3>
        <div className="feed-container">
          {liveEvents.length === 0 ? (
            <p className="muted-text" style={{ padding: '16px' }}>暂无动态，事件会在这里实时出现。</p>
          ) : (
            liveEvents.slice(-20).reverse().map((ev, i) => (
              <div key={`${ev.timestamp}-${i}`} className="feed-item">
                <span className="feed-icon">{eventIcon(ev.type)}</span>
                <div className="feed-content">
                  <span className="feed-type">{ev.type.replace(/_/g, ' ')}</span>
                  {ev.botName && <span className="feed-bot">{ev.botName}</span>}
                  {ev.handoffFrom && ev.handoffTo && (
                    <span className="feed-bot">{ev.handoffFrom} → {ev.handoffTo}</span>
                  )}
                  {ev.text && <span className="feed-text">{ev.text.length > 80 ? ev.text.slice(0, 80) + '...' : ev.text}</span>}
                </div>
                <span className="feed-time">{formatTime(ev.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-xl)' }}>
        <h3 className="section-title">快捷操作</h3>
        <div className="link-grid">
          <ActionLink to="/chat" label="对话" />
          <ActionLink to="/sessions" label="会话" />
          <ActionLink to="/agent-builder" label="员工 Builder" />
          <ActionLink to="/orchestration" label="多员工工作流" />
          <ActionLink to="/employees" label="数字员工" />
          <ActionLink to="/skills-marketplace" label="技能市场" />
        </div>
      </div>
    </section>
  );
}

function eventIcon(type: string): string {
  const icons: Record<string, string> = {
    message_received: '\u{1F4E8}',
    agent_thinking_start: '\u{1F9E0}',
    agent_reply_sent: '\u{1F4AC}',
    bot_connected: '\u{1F7E2}',
    bot_disconnected: '\u{1F534}',
    orchestration_agent_start: '\u{1F916}',
    orchestration_handoff: '\u{1F501}',
    orchestration_cue_user: '\u{2753}',
    orchestration_done: '\u{2705}',
  };
  return icons[type] ?? '\u{1F4CB}';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
