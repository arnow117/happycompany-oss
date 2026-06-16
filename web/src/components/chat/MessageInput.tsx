import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { ArrowUp, Paperclip, X, ImageIcon, Loader2 } from 'lucide-react';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: '清除当前会话上下文' },
  { cmd: '/help', desc: '显示可用命令列表' },
  { cmd: '/list', desc: '列出所有可用的 Bot' },
  { cmd: '/status', desc: '查看当前 Bot 状态' },
  { cmd: '/recall', desc: '查看最近消息记录' },
] as const;

interface PendingImage {
  name: string;
  data: string;
  mimeType: string;
  preview: string;
}

interface MessageInputProps {
  onSend: (content: string, attachments?: Array<{ data: string; mimeType: string }>) => Promise<boolean> | boolean;
  disabled?: boolean;
  isStreaming?: boolean;
  onAbort?: () => void;
  onResetSession?: () => void;
  draftKey?: string;
  draftText?: string;
  onDraftChange?: (text: string) => void;
  placeholder?: string;
  allowImageUpload?: boolean;
  statusText?: string;
}

export function MessageInput({
  onSend,
  disabled = false,
  isStreaming = false,
  onAbort,
  onResetSession,
  draftKey,
  draftText,
  onDraftChange,
  placeholder = '输入消息... (Enter 发送)',
  allowImageUpload = true,
  statusText,
}: MessageInputProps) {
  const [content, setContent] = useState(draftText ?? '');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cmdIndex, setCmdIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const compositionEndTimeRef = useRef(0);

  const showCommands = content.startsWith('/') && !content.includes(' ');
  const filteredCommands = useMemo(() => {
    if (!showCommands) return [];
    const query = content.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(query));
  }, [content, showCommands]);

  // Sync with external draft
  useEffect(() => {
    if (draftText !== undefined && draftText !== content) {
      setContent(draftText);
    }
  }, [draftText]);

  useEffect(() => {
    setContent(draftText ?? '');
    setSendError(null);
    setCmdIndex(0);
  }, [draftKey]);

  // Auto-resize textarea (1-6 lines)
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const prevOverflow = textarea.style.overflow;
    textarea.style.overflow = 'hidden';
    textarea.style.height = '0px';
    const scrollHeight = textarea.scrollHeight;
    const lineHeight = 24;
    const maxHeight = lineHeight * 6;
    const newHeight = Math.max(lineHeight, Math.min(scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflow = newHeight >= maxHeight ? 'auto' : prevOverflow || '';
  }, [content]);

  // Reset command index when filtered list changes
  useEffect(() => { setCmdIndex(0); }, [filteredCommands.length]);

  const selectCommand = useCallback((cmd: string) => {
    setContent(cmd + ' ');
    onDraftChange?.(cmd + ' ');
    textareaRef.current?.focus();
  }, [onDraftChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing) return;
    if (Date.now() - compositionEndTimeRef.current < 100) return;

    if (filteredCommands.length > 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setContent('');
        onDraftChange?.('');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCmdIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCmdIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectCommand(filteredCommands[cmdIndex].cmd);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    onDraftChange?.(e.target.value);
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    const hasImages = allowImageUpload && pendingImages.length > 0;
    if (!trimmed && !hasImages) return;
    if (disabled || sending) return;

    setSending(true);
    setSendError(null);

    const attachments = hasImages
      ? pendingImages.map((img) => ({ data: img.data, mimeType: img.mimeType }))
      : undefined;

    let ok = false;
    try {
      ok = await onSend(trimmed, attachments);
    } catch {
      ok = false;
    }

    if (ok) {
      setContent('');
      onDraftChange?.('');
      if (hasImages) {
        pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
        setPendingImages([]);
      }
    } else {
      setSendError('发送失败，请重试');
      setTimeout(() => setSendError(null), 4000);
    }
    setSending(false);
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return Promise.reject(new Error(`图片 ${file.name} 超过 5MB 限制`));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const newImages: PendingImage[] = [];
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const base64 = await readFileAsBase64(file);
          newImages.push({
            name: file.name,
            data: base64,
            mimeType: file.type,
            preview: URL.createObjectURL(file),
          });
        } catch {
          // skip
        }
      }
    }
    setPendingImages((prev) => [...prev, ...newImages]);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i]);
      }
    }
    if (imageItems.length > 0) {
      e.preventDefault();
      const newImages: PendingImage[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          try {
            const base64 = await readFileAsBase64(file);
            newImages.push({
              name: file.name || `pasted-${Date.now()}.png`,
              data: base64,
              mimeType: file.type,
              preview: URL.createObjectURL(file),
            });
          } catch {
            // skip
          }
        }
      }
      setPendingImages((prev) => [...prev, ...newImages]);
    }
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const img = prev[index];
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const hasContent = content.trim().length > 0 || pendingImages.length > 0;
  const canSend = hasContent && !sending && !isStreaming;
  const sendButtonLabel = sending
    ? '正在发送'
    : canSend && !disabled
      ? '发送消息'
      : '请输入消息后发送';

  return (
    <div
      className="pt-1 pb-3"
      style={{
        background: 'var(--color-bg-base)',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="max-w-4xl mx-auto px-4 relative">
        <div
          className="rounded-2xl"
          style={{
            background: 'var(--color-bg-deep)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {sendError && (
            <div
              className="px-4 py-2 text-xs font-medium"
              style={{ background: 'rgba(198, 69, 69, 0.1)', color: 'var(--color-danger)', borderBottom: '1px solid rgba(198, 69, 69, 0.2)', borderRadius: '16px 16px 0 0' }}
            >
              {sendError}
            </div>
          )}

          {pendingImages.length > 0 && (
            <div className="px-3 pt-2.5 pb-1" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <div className="flex items-center gap-1 mb-1.5">
                <ImageIcon className="w-3 h-3" style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  已添加 {pendingImages.length} 张图片
                </span>
                <button
                  onClick={() => {
                    pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
                    setPendingImages([]);
                  }}
                  className="ml-auto text-[11px] cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  清空
                </button>
              </div>
              <div className="flex flex-wrap gap-2 pb-1.5">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.preview} alt={img.name} className="w-16 h-16 object-cover rounded-lg" style={{ border: '1px solid var(--color-border)' }} />
                    <button
                      onClick={() => removePendingImage(i)}
                      aria-label={`移除图片 ${img.name}`}
                      title={`移除图片 ${img.name}`}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      style={{ background: 'rgba(20,20,19,0.7)', color: 'white' }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 pt-3 pb-1">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; compositionEndTimeRef.current = Date.now(); }}
              onPaste={allowImageUpload ? handlePaste : undefined}
              placeholder={isStreaming ? 'Bot 正在回复...' : placeholder}
              disabled={disabled}
              className="w-full text-base leading-6 resize-none focus:outline-none"
              style={{
                minHeight: '28px',
                maxHeight: '144px',
                fontFamily: 'var(--font-body)',
                background: 'transparent',
                color: 'var(--color-text-primary)',
              }}
              rows={1}
            />
          </div>

          <div className="flex items-center px-2 pb-2.5">
            <div className="flex items-center gap-0.5">
              {allowImageUpload && (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-10 h-10 rounded-lg flex items-center justify-center transition-all cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-overlay)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  aria-label="添加图片"
                  title="添加图片"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              )}
              {onResetSession && (
                <button
                  type="button"
                  onClick={onResetSession}
                  className="w-10 h-10 rounded-lg flex items-center justify-center transition-all cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'; e.currentTarget.style.color = '#b45309'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  aria-label="清除上下文"
                  title="清除上下文"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex-1" />
            {isStreaming && onAbort ? (
              <button
                onClick={onAbort}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-all cursor-pointer"
                style={{ background: 'rgba(198, 69, 69, 0.1)', color: 'var(--color-danger)' }}
                aria-label="停止回复"
                title="停止"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend || disabled}
                aria-label={sendButtonLabel}
                title={sendButtonLabel}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer"
                style={{
                  background: canSend && !disabled ? 'var(--color-accent)' : 'var(--color-bg-overlay)',
                  color: canSend && !disabled ? 'white' : 'var(--color-text-muted-soft)',
                  transform: canSend ? 'scale(1)' : 'scale(1)',
                }}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {statusText && (
          <div className="px-1 pt-1.5 text-[11px]" style={{ color: disabled ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
            {statusText}
          </div>
        )}

        {filteredCommands.length > 0 && (
          <div
            className="absolute bottom-full left-4 right-4 mb-2 rounded-xl overflow-hidden"
            style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
          >
            {filteredCommands.map((c, i) => (
              <button
                key={c.cmd}
                onClick={() => selectCommand(c.cmd)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors"
                style={{
                  background: i === cmdIndex ? 'var(--color-bg-overlay)' : 'transparent',
                  borderBottom: i < filteredCommands.length - 1 ? '1px solid var(--color-border-soft)' : 'none',
                }}
                onMouseEnter={() => setCmdIndex(i)}
              >
                <span className="text-sm font-mono font-medium" style={{ color: 'var(--color-accent)', minWidth: '64px' }}>{c.cmd}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.desc}</span>
              </button>
            ))}
            <div className="px-4 py-1.5 text-[10px]" style={{ background: 'var(--color-bg-overlay)', color: 'var(--color-text-muted-soft)' }}>
              Tab 选择 · Enter 发送 · Esc 关闭
            </div>
          </div>
        )}
      </div>
      {allowImageUpload && (
        <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
      )}
    </div>
  );
}
