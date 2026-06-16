import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import React, { useState, useMemo, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import 'highlight.js/styles/github.css';

interface MarkdownRendererProps {
  content: string;
  variant?: 'chat' | 'compact';
  streaming?: boolean;
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    span: [...(defaultSchema.attributes?.span || []), 'className', 'style'],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'style'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as Record<string, unknown>).children as React.ReactNode);
  return '';
}

function CodeBlock({ className, children, variant = 'chat', ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string; variant?: 'chat' | 'compact' }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match?.[1];
  const codeString = extractText(children).replace(/\n$/, '');
  const isBlock = Boolean(match) || codeString.includes('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isBlock) {
    return (
      <div className="relative group my-3 overflow-hidden rounded-lg">
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors"
            style={{ background: 'var(--color-bg-overlay)', color: 'var(--color-text-muted)' }}
          >
            {copied ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> 复制</>}
          </button>
        </div>
        {lang && (
          <div
            className="px-3 py-1.5 text-[11px] font-medium border-b"
            style={{
              background: 'var(--color-bg-overlay)',
              color: 'var(--color-text-muted-soft)',
              borderBottomColor: 'var(--color-border-soft)',
            }}
          >
            {lang}
          </div>
        )}
        <pre
          className="p-3.5 overflow-x-auto text-sm"
          style={{
            background: 'var(--color-surface-dark)',
            color: 'var(--color-on-dark)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <code className={className} {...props}>{children}</code>
        </pre>
      </div>
    );
  }

  return (
    <code
      className="px-1.5 py-0.5 rounded-md text-[0.9em] leading-relaxed break-all"
      style={{
        background: 'var(--color-bg-overlay)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-mono)',
      }}
      {...props}
    >
      {children}
    </code>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, variant = 'chat', streaming = false }: MarkdownRendererProps) {
  const baseStyle: React.CSSProperties = {
    fontSize: variant === 'chat' ? '15px' : '14px',
    lineHeight: variant === 'chat' ? 1.65 : 1.6,
    color: 'var(--color-text-primary)',
  };

  const remarkPlugins = useMemo(
    () => (streaming ? [remarkGfm, remarkBreaks] : [remarkGfm, remarkBreaks]),
    [streaming],
  );

  const rehypePlugins = useMemo(
    () =>
      streaming
        ? ([[rehypeHighlight] as const])
        : ([rehypeRaw, [rehypeHighlight] as const, [rehypeSanitize, sanitizeSchema] as const]),
    [streaming],
  );

  return (
    <div style={baseStyle}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins as any[]}
        rehypePlugins={rehypePlugins as any[]}
        components={{
          code: (props) => <CodeBlock {...props} variant={variant} />,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline break-all" style={{ color: 'var(--color-accent)' }}>
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto">
              <table style={{ minWidth: '100%', borderCollapse: 'collapse', border: '1px solid var(--color-border)' }}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: 'var(--color-bg-raised)' }}>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          th: ({ children }) => (
            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, border: '1px solid var(--color-border)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{ padding: '6px 12px', border: '1px solid var(--color-border)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
              {children}
            </td>
          ),
          ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '24px', marginTop: '8px', marginBottom: '8px' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '24px', marginTop: '8px', marginBottom: '8px' }}>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          p: ({ children }) => <p style={{ marginTop: '8px', marginBottom: '8px' }}>{children}</p>,
          h1: ({ children }) => <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '24px', marginBottom: '12px', lineHeight: 1.2 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '20px', marginBottom: '10px', lineHeight: 1.25 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: '16px', marginBottom: '8px', lineHeight: 1.3 }}>{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: '4px solid var(--color-accent)', paddingLeft: '16px', marginTop: '12px', marginBottom: '12px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              {children}
            </blockquote>
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || ''}
              loading="lazy"
              className="my-3 max-w-full rounded-lg cursor-pointer"
              style={{
                maxHeight: '400px',
                objectFit: 'contain',
                border: '1px solid var(--color-border)',
              }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
