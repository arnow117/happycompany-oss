import { useRef, useEffect, useState } from 'react';
import type { AgentGraphData } from '../../lib/api';

interface AgentGraphProps {
  data: AgentGraphData | null;
}

const CARD_W = 190;
const CARD_H = 78;
const PAD = 32;
const GAP = 24;
const TAG_H = 20;

const TYPE_LABEL: Record<string, string> = { tool: 'TOOL', skill: 'SKILL', fallback: 'FB' };
const TYPE_COLOR: Record<string, string> = {
  tool: 'var(--color-accent-teal)',
  skill: 'var(--color-accent-amber)',
  fallback: 'var(--color-warning)',
};

export function AgentGraph({ data }: AgentGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 280 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setDims({ w: width, h: Math.max(height, 260) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data || data.nodes.length === 0) {
    return (
      <div ref={containerRef} style={s.placeholder}>
        <span style={s.placeholderText}>暂无数据</span>
      </div>
    );
  }

  const agentNodes = data.nodes.filter((n) => n.type === 'agent');
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  // Per-agent items grouped by type
  const agentItems = new Map<string, Record<string, Array<{ id: string; label: string }>>>();
  for (const agent of agentNodes) {
    const groups: Record<string, Array<{ id: string; label: string }>> = { tool: [], skill: [], fallback: [] };
    for (const e of data.edges) {
      if (e.source !== agent.id || e.type !== 'tool-call') continue;
      const target = nodeMap.get(e.target);
      if (!target) continue;
      const t = target.type as string;
      if (!groups[t]) groups[t] = [];
      const short = target.label.replace(/^med_crm:/, '').replace(/^device_/, '');
      groups[t].push({ id: target.id, label: short.length > 14 ? short.slice(0, 13) + '…' : short });
    }
    agentItems.set(agent.id, groups);
  }

  // Data-flow edges between agents
  const agentIdToIdx = new Map(agentNodes.map((a, i) => [a.id, i]));
  const agentFlows: Array<{ from: number; to: number; label: string }> = [];
  for (const e of data.edges) {
    if (e.type !== 'data-flow') continue;
    const fi = agentIdToIdx.get(e.source);
    const ti = agentIdToIdx.get(e.target);
    if (fi !== undefined && ti !== undefined) {
      agentFlows.push({ from: fi, to: ti, label: e.label || '' });
    }
  }

  // Layout: horizontal cards, wrap if needed
  const cols = Math.max(1, Math.floor((dims.w - PAD) / (CARD_W + GAP)));
  const offsetX = Math.max(PAD, (dims.w - cols * (CARD_W + GAP) + GAP) / 2);

  const totalRows = Math.ceil(agentNodes.length / cols);
  const svgW = Math.max(dims.w, cols * (CARD_W + GAP) + PAD);
  const svgH = Math.max(dims.h, totalRows * (CARD_H + GAP + 60) + PAD * 2);

  const agentCenters = agentNodes.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      cx: offsetX + col * (CARD_W + GAP) + CARD_W / 2,
      cy: PAD + row * (CARD_H + GAP + 60) + CARD_H / 2,
    };
  });

  return (
    <div ref={containerRef} style={s.container}>
      <svg width={svgW} height={svgH} style={s.svg} role="img" aria-label="Agent 协作图谱">
        <defs>
          <marker id="ar-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
          </marker>
        </defs>

        {/* Agent cards */}
        {agentNodes.map((agent, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const cx = offsetX + col * (CARD_W + GAP);
          const cy = PAD + row * (CARD_H + GAP + 60);
          const isExp = expanded.has(agent.id);
          const items = agentItems.get(agent.id) || {};
          const totalItems = Object.values(items).reduce((s, a) => s + a.length, 0);
          const cardH = isExp ? CARD_H + totalItems * (TAG_H + 4) + 24 : CARD_H;

          return (
            <g key={agent.id} onClick={() => {
              const next = new Set(expanded);
              if (next.has(agent.id)) next.delete(agent.id); else next.add(agent.id);
              setExpanded(next);
            }} style={{ cursor: 'pointer' }}>
              {/* Card bg */}
              <rect x={cx} y={cy} width={CARD_W} height={cardH} rx="10" ry="10"
                fill="var(--color-surface-dark)" stroke="rgba(204,120,92,0.3)" strokeWidth="1" />
              {/* Accent bar */}
              <rect x={cx + 1} y={cy + 1} width={CARD_W - 2} height={3} rx="1.5"
                fill="var(--color-accent)" opacity={0.7} />

              {/* Avatar circle */}
              <circle cx={cx + 24} cy={cy + 30} r="14" fill="var(--color-accent)" opacity="0.2" />
              <text x={cx + 24} y={cy + 31} fill="var(--color-accent)" fontSize="14" fontWeight={700}
                textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: 'none' }}>
                {agent.label.charAt(0)}
              </text>

              {/* Name + role */}
              <text x={cx + 46} y={cy + 26} fill="var(--color-on-dark)" fontSize="13" fontWeight={600}
                dominantBaseline="central" style={{ pointerEvents: 'none' }}>
                {agent.label}
              </text>
              <text x={cx + 46} y={cy + 42} fill="var(--color-text-muted-soft)" fontSize="10"
                dominantBaseline="central" style={{ pointerEvents: 'none' }}>
                {isExp ? '▲ 收起' : `▼ ${totalItems} 项能力`}
              </text>

              {/* Expanded: items grouped by type */}
              {isExp && (
                <g style={{ pointerEvents: 'none' }}>
                  {(['tool', 'skill', 'fallback'] as const).map((type, ti) => {
                    const arr = items[type] || [];
                    if (arr.length === 0) return null;
                    const sectionY = cy + CARD_H + ti * (TAG_H + 6) + 8;

                    return (
                      <g key={`${agent.id}-${type}`}>
                        <text x={cx + 14} y={sectionY + TAG_H / 2}
                          fill={TYPE_COLOR[type]} fontSize="9" fontWeight={700}
                          dominantBaseline="central" style={{ letterSpacing: '1.2px' }}>
                          {TYPE_LABEL[type]}
                        </text>
                        {arr.map((item, j) => (
                          <g key={item.id}>
                            <rect x={cx + 60 + j * 62} y={sectionY + 2} width="56" height={TAG_H - 4} rx="3"
                              fill={TYPE_COLOR[type]} opacity="0.1" />
                            <text x={cx + 60 + j * 62 + 28} y={sectionY + TAG_H / 2}
                              fill={TYPE_COLOR[type]} fontSize="8" fontWeight={400}
                              textAnchor="middle" dominantBaseline="central">
                              {item.label}
                            </text>
                          </g>
                        ))}
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          );
        })}

        {/* Agent-to-agent data flow arrows (on top of cards) */}
        {agentFlows.map((flow) => {
          const from = agentCenters[flow.from];
          const to = agentCenters[flow.to];
          if (!from || !to) return null;
          const x1 = from.cx + CARD_W / 2 + 6;
          const x2 = to.cx - CARD_W / 2 - 6;
          const midX = (x1 + x2) / 2;
          const midY = (from.cy + to.cy) / 2;
          return (
            <g key={`flow-${flow.from}-${flow.to}`} style={{ pointerEvents: 'none' }}>
              <rect x={midX - 20} y={midY - 16} width="40" height="16" rx="4"
                fill="var(--color-accent)" opacity="0.85" />
              <text x={midX} y={midY - 4} fill="white"
                fontSize="11" fontWeight={600} textAnchor="middle">
                {flow.label}
              </text>
              <path
                d={`M ${x1} ${from.cy} L ${midX - 24} ${from.cy} L ${midX} ${from.cy > to.cy ? midY - 12 : midY + 12} L ${midX + 24} ${to.cy} L ${x2} ${to.cy}`}
                fill="none" stroke="var(--color-accent)" strokeWidth="2"
                markerEnd="url(#ar-flow)" opacity={0.8}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const s = {
  container: {
    width: '100%', minHeight: '260px', borderRadius: 'var(--radius-lg)',
    background: 'var(--color-surface-dark)', overflow: 'auto',
  } as React.CSSProperties,
  svg: { display: 'block' } as React.CSSProperties,
  placeholder: {
    width: '100%', minHeight: '260px', borderRadius: 'var(--radius-lg)',
    background: 'var(--color-surface-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
  placeholderText: {
    fontSize: 'var(--text-base)', color: 'var(--color-on-dark-soft)', fontFamily: 'var(--font-body)',
  } as React.CSSProperties,
};
