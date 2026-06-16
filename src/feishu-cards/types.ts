export type CardStatus = 'running' | 'done' | 'warning' | 'error';

export interface ToolCallStat {
  name: string;
  count: number;
}

export interface CardMeta {
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
  numTurns?: number;
  toolCalls?: ToolCallStat[];
  toolCount?: number;
}

export interface AgentCardInput {
  text: string;
  status: CardStatus;
  title?: string;
  titlePrefix?: string;
  subtitle?: string;
  meta?: CardMeta;
  thinking?: string;
  footer?: string;
  completedAtMs?: number;
}

export type FeishuCardV2 = Record<string, unknown>;
