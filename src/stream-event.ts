export type StreamEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_use_start'
  | 'tool_use_end'
  | 'tool_progress'
  | 'hook_started'
  | 'hook_progress'
  | 'hook_response'
  | 'task_start'
  | 'task_notification'
  | 'handoff'
  | 'handoff_result'
  | 'todo_update'
  | 'usage'
  | 'status'
  | 'init';

export interface StreamEvent {
  eventType: StreamEventType;
  turnId?: string;
  sessionId?: string;
  messageUuid?: string;
  isSynthetic?: boolean;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  elapsedSeconds?: number;
  hookName?: string;
  hookEvent?: string;
  hookOutcome?: string;
  statusText?: string;
  taskDescription?: string;
  taskId?: string;
  taskStatus?: string;
  taskSummary?: string;
  handoffFrom?: string;
  handoffTo?: string;
  handoffReason?: string;
  handoffStatus?: 'completed' | 'failed';
  handoffResult?: string;
  contractId?: string;
  parentContractId?: string;
  isBackground?: boolean;
  isTeammate?: boolean;
  toolInput?: Record<string, unknown>;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    durationMs: number;
    numTurns: number;
    modelUsage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }>;
  };
}
