export interface AgentObservabilityUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  durationMs: number;
  apiDurationMs?: number;
  numTurns: number;
  modelUsage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
}

export interface AgentObservabilityInit {
  sessionId: string;
  model: string;
  cwd: string;
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
  skills: string[];
  plugins: Array<{ name: string; path: string }>;
  permissionMode: string;
  claudeCodeVersion: string;
}

export interface AgentObservabilityToolCall {
  toolName: string;
  toolUseId: string;
  parentToolUseId?: string | null;
  elapsedMs?: number;
  input?: Record<string, unknown>;
  status: 'running' | 'completed';
}

export interface AgentObservabilityHandoff {
  from: string;
  to: string;
  reason?: string;
  status?: 'pending' | 'completed' | 'failed';
  result?: string;
  contractId?: string;
  parentContractId?: string;
}

export interface AgentObservabilitySummary {
  status: 'completed' | 'failed' | 'interrupted';
  stopReason?: string | null;
  errors?: string[];
  permissionDenials?: Array<{
    toolName: string;
    toolUseId: string;
  }>;
}

export interface AgentObservability {
  summary: AgentObservabilitySummary;
  init?: AgentObservabilityInit;
  usage?: AgentObservabilityUsage;
  toolCalls: AgentObservabilityToolCall[];
  handoffs: AgentObservabilityHandoff[];
  startedAt: number;
  finishedAt: number;
}
