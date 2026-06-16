import { useState, memo, type ReactNode } from 'react';
import { Activity, Check, ChevronDown, Clock, Copy, Cpu, DollarSign, GitBranch, Wrench } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { AgentObservability, ChatMessage } from '../../stores/chat';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function ReasoningBlock({ content, durationMs }: { content: string; durationMs?: number }) {
  const [expanded, setExpanded] = useState(false);
  const label = durationMs != null && durationMs > 0 ? formatThinkingDuration(durationMs) : 'Reasoning';

  return (
    <div className="mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.05)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
        style={{ transition: 'background 150ms' }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="text-xs font-medium" style={{ color: '#b45309' }}>{label}</span>
        <span className="flex-1" />
        <svg className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'} />
        </svg>
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 text-sm whitespace-pre-wrap break-words overflow-y-auto"
          style={{
            maxHeight: '256px',
            borderTop: '1px solid rgba(245, 158, 11, 0.15)',
            color: 'rgba(146, 64, 14, 0.7)',
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

function formatThinkingDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatCost(value?: number): string {
  if (!value || value <= 0) return '$0.0000';
  return `$${value.toFixed(4)}`;
}

function totalTokens(observability: AgentObservability): number {
  const usage = observability.usage;
  if (!usage) return 0;
  return usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}

function AgentObservabilityPanel({ observability }: { observability: AgentObservability }) {
  const [expanded, setExpanded] = useState(false);
  const usage = observability.usage;
  const statusLabel = observability.summary.status === 'failed'
    ? '失败'
    : observability.summary.status === 'interrupted'
      ? '已中断'
      : '已完成';
  const statusColor = observability.summary.status === 'failed'
    ? '#b91c1c'
    : observability.summary.status === 'interrupted'
      ? '#b45309'
      : '#15803d';
  const duration = usage?.durationMs || Math.max(0, observability.finishedAt - observability.startedAt);
  const tokens = totalTokens(observability);

  return (
    <div
      className="mt-3 rounded-lg overflow-hidden text-xs"
      style={{ border: '1px solid var(--color-border-soft)', background: 'var(--color-bg-input)' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <Activity className="w-3.5 h-3.5 flex-shrink-0" style={{ color: statusColor }} />
        <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>运行看板</span>
        <span style={{ color: statusColor }}>{statusLabel}</span>
        {observability.init?.model && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <Cpu className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{observability.init.model}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDuration(duration)}
        </span>
        {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
        {observability.toolCalls.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {observability.toolCalls.length}
          </span>
        )}
        {observability.handoffs.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {observability.handoffs.length}
          </span>
        )}
        <span className="flex-1" />
        <ChevronDown
          className="w-3.5 h-3.5 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
          <div className="grid gap-2 pt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
            <Metric label="模型" value={observability.init?.model || 'unknown'} icon={<Cpu className="w-3 h-3" />} />
            <Metric label="耗时" value={formatDuration(duration)} icon={<Clock className="w-3 h-3" />} />
            <Metric label="成本" value={formatCost(usage?.costUSD)} icon={<DollarSign className="w-3 h-3" />} />
            <Metric label="轮次" value={String(usage?.numTurns ?? 0)} icon={<Activity className="w-3 h-3" />} />
          </div>

          {usage && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
              <Metric label="输入 tokens" value={usage.inputTokens.toLocaleString()} />
              <Metric label="输出 tokens" value={usage.outputTokens.toLocaleString()} />
              <Metric label="缓存读取" value={usage.cacheReadInputTokens.toLocaleString()} />
              <Metric label="缓存写入" value={usage.cacheCreationInputTokens.toLocaleString()} />
            </div>
          )}

          {observability.init && (
            <div className="space-y-1.5">
              <DetailLine label="Session" value={observability.init.sessionId} />
              <DetailLine label="CWD" value={observability.init.cwd} />
              <DetailLine label="权限" value={observability.init.permissionMode} />
              <DetailLine label="工具" value={observability.init.tools.slice(0, 12).join(', ') || '无'} />
              <DetailLine label="MCP" value={observability.init.mcpServers.map((item) => `${item.name}:${item.status}`).join(', ') || '无'} />
            </div>
          )}

          {observability.toolCalls.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>工具调用</div>
              {observability.toolCalls.map((tool) => (
                <div key={tool.toolUseId} className="rounded-md px-2 py-1.5" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3" />
                    <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{tool.toolName}</span>
                    <span>{tool.status === 'completed' ? '完成' : '运行中'}</span>
                    {tool.elapsedMs !== undefined && <span>{formatDuration(tool.elapsedMs)}</span>}
                  </div>
                  {tool.input && (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-muted)' }}>
                      {JSON.stringify(tool.input, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {observability.handoffs.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>协同交接</div>
              {observability.handoffs.map((handoff, index) => (
                <div key={`${handoff.from}-${handoff.to}-${index}`} className="rounded-md px-2 py-1.5" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span style={{ color: 'var(--color-text-primary)' }}>{handoff.from}</span>
                    <span>→</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{handoff.to}</span>
                    {handoff.status && <span>{handoff.status === 'completed' ? '已完成' : handoff.status === 'failed' ? '失败' : '处理中'}</span>}
                  </div>
                  {handoff.reason && <div className="mt-1">{handoff.reason}</div>}
                  {handoff.result && <div className="mt-1" style={{ color: 'var(--color-text-primary)' }}>{handoff.result}</div>}
                </div>
              ))}
            </div>
          )}

          {(observability.summary.errors?.length || observability.summary.permissionDenials?.length) && (
            <div className="space-y-1.5" style={{ color: '#b91c1c' }}>
              {observability.summary.errors?.map((error, index) => <div key={index}>{error}</div>)}
              {observability.summary.permissionDenials?.map((denial) => (
                <div key={denial.toolUseId}>权限拒绝：{denial.toolName}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-md px-2 py-1.5 min-w-0" style={{ background: 'var(--color-bg-subtle)' }}>
      <div className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 truncate font-medium" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-14 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="min-w-0 break-all" style={{ color: 'var(--color-text-secondary)' }}>{value}</span>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.source === 'user';

  const time = new Date(message.timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');

  const images = message.attachments?.filter((a) => a.type === 'image') ?? [];
  const hasOnlyImages = !message.text.trim() && images.length > 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end mb-4 group">
        <div className="flex flex-col items-end min-w-0" style={{ maxWidth: '75%' }}>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 justify-end">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={i.toString()}
                  className="rounded-lg object-cover cursor-pointer"
                  style={{ maxWidth: '192px', maxHeight: '192px', border: '2px solid var(--color-accent)' }}
                />
              ))}
            </div>
          )}
          {!hasOnlyImages && (
            <div
              className="px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
              style={{
                background: 'var(--color-bg-overlay)',
                color: 'var(--color-text-primary)',
                borderRadius: '16px 16px 4px 16px',
              }}
            >
              {message.text}
            </div>
          )}
          <span className="text-xs mt-1.5 mr-1" style={{ color: 'var(--color-text-muted-soft)' }}>{time}</span>
        </div>
      </div>
    );
  }

  // Bot message
  return (
    <div className="mb-4 group">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted-soft)' }}>
          {message.botName || 'AI'}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted-soft)' }}>{time}</span>
      </div>

      <div className="overflow-hidden" style={{ fontFamily: 'var(--font-display)' }}>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={i.toString()}
                className="rounded-lg object-cover cursor-pointer"
                style={{ maxWidth: '192px', maxHeight: '192px', border: '1px solid var(--color-border)' }}
              />
            ))}
          </div>
        )}
        {!hasOnlyImages && (
          <div className="max-w-none overflow-hidden">
            <MarkdownRenderer content={message.text} variant="chat" />
          </div>
        )}
        {message.observability && <AgentObservabilityPanel observability={message.observability} />}
        {isStreaming && (
          <span
            className="inline-block w-0.5 h-4 ml-0.5"
            style={{
              background: 'var(--color-accent)',
              animation: 'blink 1s step-end infinite',
              verticalAlign: 'text-bottom',
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="h-7 px-2 rounded-md flex items-center gap-1 text-xs cursor-pointer transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-overlay)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          title="复制"
        >
          {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
});
