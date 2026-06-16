import { useEffect, useState, useRef } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Loader2, OctagonX, Users, XCircle } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolActivityCard } from './ToolActivityCard';
import { TodoProgressPanel } from './TodoProgressPanel';
import type { StreamingState } from '../../stores/chat';

function formatThinkingDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

interface StreamingContentProps {
  streaming: StreamingState;
  localElapsed: Record<string, number>;
  thinkingExpanded: boolean;
  setThinkingExpanded: (v: boolean) => void;
  thinkingRef: React.RefObject<HTMLDivElement | null>;
  handleThinkingScroll: () => void;
}

function StreamingContent({ streaming, localElapsed, thinkingExpanded, setThinkingExpanded, thinkingRef, handleThinkingScroll }: StreamingContentProps) {
  const cardTools = streaming.activeTools.filter((t) => t.toolName !== 'AskUserQuestion');

  return (
    <>
      {streaming.systemStatus && (
        <div className="flex items-center gap-2 text-[13px] mb-2" style={{ color: 'var(--color-text-muted)' }}>
          <svg className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-accent)' }} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>{streaming.systemStatus === 'compacting' ? '上下文压缩中...' : streaming.systemStatus}</span>
        </div>
      )}

      {streaming.thinkingText && (
        <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.05)' }}>
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
            style={{ transition: 'background 150ms' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <span className="text-xs font-medium" style={{ color: '#b45309' }}>
              {streaming.isThinking
                ? 'Reasoning...'
                : streaming.thinkingDurationMs > 0
                  ? formatThinkingDuration(streaming.thinkingDurationMs)
                  : 'Reasoning'}
            </span>
            {streaming.isThinking && (
              <span className="flex gap-0.5 ml-0.5">
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#fbbf24', animationDelay: '-0.3s' }} />
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#fbbf24', animationDelay: '-0.15s' }} />
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#fbbf24' }} />
              </span>
            )}
            <span className="flex-1" />
            {thinkingExpanded
              ? <ChevronUp className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} />
              : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} />}
          </button>
          {thinkingExpanded && (
            <div
              ref={thinkingRef}
              onScroll={handleThinkingScroll}
              className="px-3 pb-3 text-sm whitespace-pre-wrap break-words overflow-y-auto"
              style={{ maxHeight: '256px', borderTop: '1px solid rgba(245, 158, 11, 0.15)', color: 'rgba(146, 64, 14, 0.7)' }}
            >
              {streaming.thinkingText}
            </div>
          )}
        </div>
      )}

      {cardTools.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {cardTools.map((tool) => (
            <ToolActivityCard key={tool.toolUseId} tool={tool} localElapsed={localElapsed[tool.toolUseId]} />
          ))}
        </div>
      )}

      {streaming.collaborations.length > 0 && (
        <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-raised)' }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-soft)', color: 'var(--color-text-secondary)' }}>
            <Users className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs font-medium">协同处理中</span>
          </div>
          <div className="px-3 py-2 space-y-2">
            {streaming.collaborations.map((item) => (
              <div key={`${item.from}-${item.to}-${item.timestamp}`} className="text-xs">
                <div className="flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-primary)' }}>
                  <span>{item.from}</span>
                  <ArrowRight className="w-3 h-3" style={{ color: 'var(--color-text-muted)' }} />
                  <span>{item.to}</span>
                  <span className="inline-flex items-center gap-1 ml-1" style={{ color: item.status === 'completed' ? '#15803d' : item.status === 'failed' ? '#b91c1c' : 'var(--color-text-muted)' }}>
                    {item.status === 'completed'
                      ? <CheckCircle2 className="w-3 h-3" />
                      : item.status === 'failed'
                        ? <XCircle className="w-3 h-3" />
                        : <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : '处理中'}</span>
                  </span>
                </div>
                {item.reason && (
                  <div className="mt-1" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    {item.reason}
                  </div>
                )}
                {item.result && (
                  <div className="mt-2 rounded-md px-2.5 py-2" style={{ border: '1px solid var(--color-border-soft)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                    <div className="mb-1 font-medium" style={{ color: 'var(--color-text-primary)' }}>协同结果</div>
                    <MarkdownRenderer
                      content={item.result.length > 1200 ? `${item.result.slice(0, 1200)}...` : item.result}
                      variant="chat"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {streaming.todos && streaming.todos.length > 0 && (
        <TodoProgressPanel todos={streaming.todos} />
      )}

      {streaming.partialText && (
        <div className="max-w-none overflow-hidden">
          <MarkdownRenderer
            content={streaming.partialText.length > 3000 ? '...' + streaming.partialText.slice(-2000) : streaming.partialText}
            variant="chat"
            streaming
          />
          <span
            className="inline-block w-0.5 h-4 ml-0.5"
            style={{ background: 'var(--color-accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom' }}
          />
        </div>
      )}

      {streaming.interrupted && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1.5 text-[13px]" style={{ color: '#b45309' }}>
            <OctagonX className="w-3.5 h-3.5" />
            <span>已中断</span>
          </div>
        </div>
      )}
    </>
  );
}

interface StreamingDisplayProps {
  streamingKey: string;
  isWaiting: boolean;
  senderName?: string;
}

export function StreamingDisplay({ streamingKey, isWaiting, senderName = 'AI' }: StreamingDisplayProps) {
  const streaming = useChatStore((s) => s.streaming[streamingKey]);
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const userToggledThinkingRef = useRef(false);
  const [localElapsed, setLocalElapsed] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!thinkingExpanded || !thinkingRef.current || userScrolledRef.current) return;
    thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
  }, [streaming?.thinkingText, thinkingExpanded]);

  useEffect(() => {
    setThinkingExpanded(true);
    userScrolledRef.current = false;
    userToggledThinkingRef.current = false;
    setLocalElapsed({});
  }, [streamingKey]);

  const activeToolIdSignature = streaming?.activeTools.map((t) => t.toolUseId).join('|') ?? '';
  useEffect(() => {
    if (!activeToolIdSignature) { setLocalElapsed({}); return; }
    const interval = setInterval(() => {
      const now = Date.now();
      const tools = useChatStore.getState().streaming[streamingKey]?.activeTools ?? [];
      const next: Record<string, number> = {};
      for (const tool of tools) {
        next[tool.toolUseId] = (now - tool.startTime) / 1000;
      }
      setLocalElapsed(next);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeToolIdSignature, streamingKey]);

  const handleThinkingScroll = () => {
    if (!thinkingRef.current) return;
    userScrolledRef.current = (thinkingRef.current.scrollHeight - thinkingRef.current.scrollTop - thinkingRef.current.clientHeight) >= 30;
  };

  const hasStreamData = streaming && (
    streaming.partialText ||
    streaming.thinkingText ||
    streaming.activeTools.length > 0 ||
    streaming.collaborations.length > 0 ||
    streaming.systemStatus ||
    (streaming.todos && streaming.todos.length > 0)
  );

  if (!isWaiting && !hasStreamData) return null;

  if (isWaiting && !hasStreamData) {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted-soft)' }}>{senderName}</span>
        </div>
        <div className="rounded-xl px-5 py-4" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-accent)', animationDelay: '-0.3s' }} />
            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-accent)', animationDelay: '-0.15s' }} />
            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-accent)' }} />
            <span className="text-sm ml-1" style={{ color: 'var(--color-text-muted)' }}>正在思考...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!streaming) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted-soft)' }}>{senderName}</span>
        {streaming.isThinking && (
          <span className="flex gap-0.5 ml-1">
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: 'var(--color-accent)', animationDelay: '-0.3s' }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: 'var(--color-accent)', animationDelay: '-0.15s' }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: 'var(--color-accent)' }} />
          </span>
        )}
      </div>
      <div className="rounded-xl px-5 py-4 overflow-hidden" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-card)' }}>
        <StreamingContent
          streaming={streaming}
          localElapsed={localElapsed}
          thinkingExpanded={thinkingExpanded}
          setThinkingExpanded={(v) => { setThinkingExpanded(v); userToggledThinkingRef.current = true; if (v) userScrolledRef.current = false; }}
          thinkingRef={thinkingRef}
          handleThinkingScroll={handleThinkingScroll}
        />
      </div>
    </div>
  );
}
