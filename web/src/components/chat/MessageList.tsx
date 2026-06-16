import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { StreamingDisplay } from './StreamingDisplay';
import { useChatStore } from '../../stores/chat';
import { Bot, ChevronDown, ClipboardList, Loader2, MessageSquareText, Search, Wrench } from 'lucide-react';
import type { ChatMessage } from '../../stores/chat';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  scrollTrigger?: number;
  isWaiting?: boolean;
  onInterrupt?: () => void;
  onSend?: (content: string) => void;
  selectedWorkdir?: string;
  chatId?: string;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  showQuickPrompts?: boolean;
  activeTitle?: string;
  activeSubtitle?: string;
}

type FlatItem =
  | { type: 'date'; content: string }
  | { type: 'message'; content: ChatMessage };

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const quickPrompts = [
  { icon: Search, title: '查客户跟进', desc: '查询最近客户跟进记录并整理下一步动作' },
  { icon: ClipboardList, title: '生成日报', desc: '汇总今天的业务进展和待处理事项' },
  { icon: MessageSquareText, title: '起草回复', desc: '根据上下文起草一段对客户或同事的回复' },
  { icon: Wrench, title: '排查流程', desc: '帮我定位一个业务流程卡住的原因' },
];

export function MessageList({
  messages,
  loading,
  hasMore,
  onLoadMore,
  scrollTrigger,
  isWaiting,
  onInterrupt,
  onSend,
  selectedWorkdir,
  chatId,
  welcomeTitle = '你好，有什么可以帮你？',
  welcomeSubtitle = '选择下方话题快速开始，或直接输入你的问题。',
  showQuickPrompts = true,
  activeTitle,
  activeSubtitle,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevMessageCount = useRef(messages.length);

  const streamingKey = chatId ? `${selectedWorkdir || 'web'}:${chatId}` : '';

  const flatMessages = useMemo<FlatItem[]>(() => {
    const grouped = messages.reduce((acc, msg) => {
      const date = DATE_LABEL_FORMATTER.format(new Date(msg.timestamp));
      if (!acc[date]) acc[date] = [];
      acc[date].push(msg);
      return acc;
    }, {} as Record<string, ChatMessage[]>);

    const items: FlatItem[] = [];
    Object.entries(grouped).forEach(([date, msgs]) => {
      items.push({ type: 'date', content: date });
      msgs.forEach((msg) => {
        items.push({ type: 'message', content: msg });
      });
    });
    return items;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: flatMessages.length,
    getScrollElement: () => parentRef.current,
    initialOffset: flatMessages.length > 0 ? 99999999 : 0,
    getItemKey: (index) => {
      const item = flatMessages[index];
      if (!item) return index;
      if (item.type === 'date') return `date-${item.content}`;
      return item.content.id;
    },
    estimateSize: (index) => {
      const item = flatMessages[index];
      if (!item) return 100;
      if (item.type === 'date') return 48;
      const len = item.content.text.length;
      if (item.content.source === 'bot') {
        return Math.max(80, Math.ceil(len / 40) * 24 + 80);
      }
      return Math.max(48, Math.min(200, Math.ceil(len / 80) * 24 + 40));
    },
    overscan: window.innerWidth < 1024 ? 12 : 8,
  });

  // Detect at-bottom and at-top
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = parent;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
      setAutoScroll(isAtBottom);
      if (scrollTop < 100 && hasMore && !loading) {
        onLoadMore();
      }
    };
    parent.addEventListener('scroll', handleScroll);
    return () => parent.removeEventListener('scroll', handleScroll);
  }, [hasMore, loading, onLoadMore]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (autoScroll && messages.length > prevMessageCount.current) {
      requestAnimationFrame(() => {
        const parent = parentRef.current;
        if (!parent) return;
        parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, autoScroll]);

  // External scroll trigger
  useEffect(() => {
    if (scrollTrigger && scrollTrigger > 0) {
      setAutoScroll(true);
      requestAnimationFrame(() => {
        const parent = parentRef.current;
        if (!parent) return;
        parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [scrollTrigger]);

  // Initial scroll to bottom after messages load
  const initialScrollDone = useRef(flatMessages.length > 0);
  useEffect(() => {
    if (!initialScrollDone.current && flatMessages.length > 0) {
      initialScrollDone.current = true;
      prevMessageCount.current = messages.length;
      requestAnimationFrame(() => {
        const parent = parentRef.current;
        if (parent) parent.scrollTop = parent.scrollHeight;
      });
    }
  }, [flatMessages.length, messages.length]);

  // Safety net: correct scroll position after async load
  useEffect(() => {
    if (flatMessages.length === 0) return;
    const timers: number[] = [];
    for (const delay of [50, 150, 300, 500]) {
      timers.push(window.setTimeout(() => {
        const el = parentRef.current;
        if (!el) return;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (gap > 100) el.scrollTop = el.scrollHeight;
      }, delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [flatMessages.length]);

  // Auto-scroll during streaming
  const hasStreaming = useChatStore((s) => !!s.streaming[streamingKey]);
  useEffect(() => {
    if (!hasStreaming || !autoScroll) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!autoScroll) return;
        const parent = parentRef.current;
        if (parent) parent.scrollTo({ top: parent.scrollHeight });
      });
    };
    const unsub = useChatStore.subscribe(() => {
      const cur = useChatStore.getState().streaming[streamingKey];
      if (cur?.partialText || cur?.thinkingText) schedule();
    });
    return () => { unsub(); if (raf) cancelAnimationFrame(raf); };
  }, [hasStreaming, streamingKey, autoScroll]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    const parent = parentRef.current;
    if (parent) parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
  }, []);

  const isCurrentStreaming = useChatStore((s) => s.streaming[streamingKey]?.isStreaming ?? false);

  return (
    <div className="relative flex-1 overflow-hidden overflow-x-hidden">
      <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden py-6">
        <div className="max-w-4xl mx-auto px-4 min-w-0">
          {loading && hasMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin" size={24} style={{ color: 'var(--color-accent)' }} />
            </div>
          )}

          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = flatMessages[virtualItem.index];
              if (!item) return null;

              if (item.type === 'date') {
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <div className="flex justify-center my-6">
                      <span
                        className="px-4 py-1 rounded-full text-xs"
                        style={{ background: 'var(--color-bg-deep)', color: 'var(--color-text-muted-soft)', border: '1px solid var(--color-border)' }}
                      >
                        {item.content}
                      </span>
                    </div>
                  </div>
                );
              }

              const message = item.content;
              const isLastBotMessage = message.source === 'bot' && isCurrentStreaming;

              return (
                <div
                  key={virtualItem.key}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                >
                  <MessageBubble message={message} isStreaming={isLastBotMessage} />
                </div>
              );
            })}
          </div>

          {messages.length === 0 && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              <div className="max-w-2xl w-full space-y-7">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="relative w-14 h-14">
                    <div
                      className="absolute inset-0 rounded-lg animate-[breathe_3s_ease-in-out_infinite]"
                      style={{ background: 'var(--color-accent-dim)' }}
                    />
                    <div
                      className="relative w-14 h-14 flex items-center justify-center animate-[float_4s_ease-in-out_infinite]"
                      style={{ background: 'var(--color-bg-overlay)', borderRadius: 'var(--radius-lg)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
                    >
                      <Bot className="w-6 h-6" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>{welcomeTitle}</h2>
                    <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                      {welcomeSubtitle}
                    </p>
                    {activeTitle && (
                      <div
                        className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-lg text-xs max-w-full"
                        style={{ border: '1px solid var(--color-border-soft)', background: 'var(--color-bg-base)', color: 'var(--color-text-secondary)' }}
                      >
                        <span className="font-medium whitespace-nowrap flex-shrink-0">{activeTitle}</span>
                        {activeSubtitle && <span className="truncate min-w-0" style={{ color: 'var(--color-text-muted)' }}>{activeSubtitle}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {showQuickPrompts && onSend && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt.title}
                        onClick={() => onSend(prompt.desc)}
                        className="group text-left p-4 rounded-lg transition-all cursor-pointer min-w-0"
                        style={{ border: '1px solid var(--color-border-soft)', background: 'var(--color-bg-base)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-raised)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-base)'; e.currentTarget.style.borderColor = 'var(--color-border-soft)'; }}
                      >
                        <prompt.icon className="w-5 h-5 mb-2" style={{ color: 'var(--color-text-muted)' }} strokeWidth={1.75} />
                        <span className="text-sm font-medium block" style={{ color: 'var(--color-text-primary)' }}>{prompt.title}</span>
                        <span className="text-xs mt-0.5 block" style={{ color: 'var(--color-text-muted)' }}>{prompt.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {streamingKey && (
            <StreamingDisplay streamingKey={streamingKey} isWaiting={!!isWaiting} senderName={selectedWorkdir || 'AI'} />
          )}
        </div>
      </div>

      {/* Floating interrupt button */}
      {isWaiting && onInterrupt && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
          <button
            type="button"
            onClick={onInterrupt}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-full border cursor-pointer transition-colors"
            style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-deep)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-card)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.background = 'rgba(198, 69, 69, 0.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'var(--color-bg-deep)'; }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            中断
          </button>
        </div>
      )}

      {/* Scroll to bottom button */}
      {!autoScroll && messages.length > 0 && (
        <div className="absolute right-4 bottom-4">
          <button
            onClick={scrollToBottom}
            className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all"
            style={{ background: 'rgba(20,20,19,0.05)', color: 'rgba(110,106,100,0.6)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(20,20,19,0.1)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(20,20,19,0.05)'; e.currentTarget.style.color = 'rgba(110,106,100,0.6)'; }}
            title="回到底部"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
