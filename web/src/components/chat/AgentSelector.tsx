import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface AgentInfo {
  id: string;
  displayName: string;
  path?: string;
  channels?: string[];
  status?: string;
  tenant?: string;
}

interface AgentSelectorProps {
  agents: AgentInfo[];
  selectedId: string;
  onChange: (id: string) => void;
}

// Group agents: colony agents (数字员工) vs config bots (系统 Bot)
interface AgentGroup {
  label: string;
  agents: AgentInfo[];
}

const INITIAL_EMOJI = ['🧑‍💼', '🔧', '💰', '📋', '🏥', '🤖', '💻', '📊', '⚙️'];

export function AgentSelector({ agents, selectedId, onChange }: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const groups: AgentGroup[] = useMemo(() => {
    const map = new Map<string, AgentInfo[]>();

    for (const a of agents) {
      const key = a.tenant || '其他';
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }

    return Array.from(map.entries()).map(([tenant, items]) => ({
      label: tenant,
      agents: items,
    }));
  }, [agents]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        agents: g.agents.filter(
          (a) =>
            a.displayName.toLowerCase().includes(q) ||
            a.id.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.agents.length > 0);
  }, [groups, search]);

  const selectedAgent = useMemo(() => {
    if (selectedId) {
      const exact = agents.find((a) => a.id === selectedId);
      if (exact) return exact;
    }
    return agents[0];
  }, [agents, selectedId]);

  const getEmoji = (agent: AgentInfo) => {
    let hash = 0;
    for (let i = 0; i < agent.id.length; i++) {
      hash = (hash * 31 + agent.id.charCodeAt(i)) & 0xffff;
    }
    return INITIAL_EMOJI[hash % INITIAL_EMOJI.length];
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} style={s.wrapper}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={s.trigger}
      >
        <span style={s.triggerEmoji}>
          {selectedAgent ? getEmoji(selectedAgent) : '🤖'}
        </span>
        <span style={s.triggerName}>
          {selectedAgent?.displayName || '选择 Agent'}
        </span>
        <ChevronDown
          size={14}
          color="var(--color-text-muted)"
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--transition-fast)',
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={s.dropdown}>
          {/* Search */}
          <div style={s.searchRow}>
            <Search size={14} color="var(--color-text-muted)" />
            <input
              ref={inputRef}
              style={s.searchInput}
              placeholder="搜索 Agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setSearch('');
                }
              }}
            />
          </div>

          {/* Groups */}
          <div style={s.list}>
            {filtered.length === 0 ? (
              <div style={s.empty}>无匹配结果</div>
            ) : (
              filtered.map((group) => (
                <div key={group.label}>
                  <div style={s.groupLabel}>{group.label}</div>
                  {group.agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleSelect(agent.id)}
                      style={{
                        ...s.agentItem,
                        ...(agent.id === selectedId ? s.agentItemActive : {}),
                      }}
                    >
                      <span style={s.agentEmoji}>{getEmoji(agent)}</span>
                      <div style={s.agentInfo}>
                        <span style={s.agentName}>{agent.displayName}</span>
                        <span style={s.agentId}>{agent.id}</span>
                      </div>
                      {agent.status && (
                        <span
                          style={{
                            ...s.statusDot,
                            background:
                              agent.status === 'running'
                                ? 'var(--color-success)'
                                : 'var(--color-text-muted)',
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  wrapper: {
    position: 'relative' as const,
    flexShrink: 0,
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-body)',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    whiteSpace: 'nowrap' as const,
    transition: 'border-color var(--transition-fast)',
  },
  triggerEmoji: {
    fontSize: '16px',
    lineHeight: 1,
  },
  triggerName: {
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '120px',
  },
  dropdown: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    left: 0,
    width: '280px',
    maxHeight: '360px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-base)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderBottom: '1px solid var(--color-border)',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text-primary)',
    fontSize: '13px',
    fontFamily: 'var(--font-body)',
    outline: 'none',
  },
  list: {
    overflow: 'auto',
    padding: '4px',
    flex: 1,
  },
  groupLabel: {
    padding: '8px 10px 4px',
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
  },
  agentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '8px 10px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background var(--transition-fast)',
  },
  agentItemActive: {
    background: 'var(--color-accent-dim)',
  },
  agentEmoji: {
    fontSize: '18px',
    lineHeight: 1,
    flexShrink: 0,
  },
  agentInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
  },
  agentName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-body)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  agentId: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  empty: {
    padding: '24px',
    textAlign: 'center' as const,
    color: 'var(--color-text-muted)',
    fontSize: '13px',
  },
};
