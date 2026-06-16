import type { ToolInfo } from '../../stores/chat';

interface ToolActivityCardProps {
  tool: ToolInfo;
  localElapsed?: number;
}

function parseToolParam(toolName: string, summary?: string): { label: string; value: string } | null {
  if (!summary) return null;
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'Glob':
      return { label: 'path', value: summary };
    case 'Bash':
      return { label: 'cmd', value: summary };
    case 'Grep':
      return { label: 'pattern', value: summary };
    case 'Agent':
      return { label: 'task', value: summary };
    default:
      return summary.length > 0 ? { label: 'input', value: summary } : null;
  }
}

export function ToolActivityCard({ tool, localElapsed }: ToolActivityCardProps) {
  const elapsed = tool.elapsedSeconds ?? localElapsed;
  const isNested = tool.isNested === true;
  const displayName = tool.toolName === 'Skill' ? (tool.skillName || 'unknown') : tool.toolName;
  const param = parseToolParam(tool.toolName, tool.toolInputSummary);
  const isBash = tool.toolName === 'Bash';

  return (
    <div style={isNested ? { marginLeft: '16px', paddingLeft: '8px', borderLeft: '2px solid var(--color-border-hover)' } : undefined}>
      <div
        className="rounded-lg px-2.5 py-1.5 text-[13px]"
        style={{
          background: 'rgba(204, 120, 92, 0.05)',
          border: '1px solid rgba(204, 120, 92, 0.2)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'var(--color-accent)' }} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium" style={{ color: 'var(--color-accent)' }}>{displayName}</span>
          <span className="flex-1" />
          {elapsed != null && (
            <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{Math.round(elapsed)}s</span>
          )}
        </div>
        {param && (
          <div
            className={`mt-1 break-all overflow-y-auto ${isBash ? '' : ''}`}
            style={{
              color: 'var(--color-text-muted)',
              fontFamily: isBash ? 'var(--font-mono)' : 'var(--font-body)',
              maxHeight: '64px',
            }}
          >
            <span style={{ color: 'rgba(110,106,100,0.6)' }}>{param.label}: </span>
            {param.value}
          </div>
        )}
      </div>
    </div>
  );
}
