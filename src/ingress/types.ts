import type { FileAttachment } from '../types.js';
import type { ConversationMode, EntryChannel } from '../runtime-profile.js';

export type IngressChannel = EntryChannel;

export interface IngressAttachment {
  data: string;
  mimeType: string;
}

export interface IngressMessageInput {
  channel: IngressChannel;
  botName: string;
  tenant?: string;
  entryId?: string;
  actorId?: string;
  sessionId?: string;
  employeeId?: string;
  instanceId?: string;
  workdir?: string;
  mode?: ConversationMode;
  sdkSessionScope?: string;
  userId?: string;
  chatId: string;
  /** Channel-native message id. WS adapter may omit it (Runtime will mint one). */
  messageId?: string;
  text: string;
  /** Pre-resolved IM attachments (already downloaded). */
  files?: FileAttachment[];
  /** Inline base64 attachments (web chat image uploads). */
  attachments?: IngressAttachment[];
  receivedAt?: number;
}

export interface IngressToolStartInfo {
  toolName: string;
  toolUseId: string;
  toolInput?: Record<string, unknown>;
}

export interface IngressToolEndInfo {
  toolName: string;
  toolUseId: string;
  elapsedMs: number;
}

export interface IngressCallbacks {
  onText?: (text: string) => void;
  onToolStart?: (info: IngressToolStartInfo) => void;
  onToolEnd?: (info: IngressToolEndInfo) => void;
  onHandoff?: (info: { from: string; to: string; reason?: string }) => void;
  abortController?: AbortController;
  timeoutMs?: number;
  runtimeAgentDir?: string;
  runtimeCwd?: string;
  handoffMode?: 'auto' | 'disabled';
}

export type IngressToolStatus = 'running' | 'complete' | 'error';

export interface IngressToolCallTrace {
  name: string;
  toolUseId?: string;
  status: IngressToolStatus;
  elapsedMs?: number;
  startedAt: number;
  finishedAt?: number;
}

export type IngressMemoryOp = 'append' | 'search' | 'read' | 'write';

export interface IngressMemoryTrace {
  operation: IngressMemoryOp;
  subject: string;
  workspace?: string;
  status: 'ok' | 'error';
  at: number;
}

export interface IngressHandoffTrace {
  from: string;
  to: string;
  reason?: string;
  at: number;
}

export type IngressBusinessArtifactStatus = 'created' | 'updated' | 'triggered';

export interface IngressBusinessArtifactTrace {
  type: string;
  id?: string;
  status: IngressBusinessArtifactStatus;
  at: number;
}

export interface IngressErrorTrace {
  stage: string;
  message: string;
  at: number;
}

export interface IngressRoutingTrace {
  mode?: string;
  selectedEmployee?: string;
  boundEmployee?: string;
  selectorShown?: boolean;
}

export interface IngressAgentTrace {
  id: string;
  cwd?: string;
  workspace?: string;
}

export interface IngressRuntimeTrace {
  tenant?: string;
  entryId?: string;
  actorId?: string;
  sessionId?: string;
  employeeId?: string;
  instanceId?: string;
  workdir?: string;
  sdkSessionScope?: string;
  mode?: ConversationMode;
}

export interface IngressTrace {
  input: {
    channel: IngressChannel;
    botName: string;
    tenant?: string;
    userId?: string;
    chatId: string;
    messageId?: string;
  };
  routing: IngressRoutingTrace;
  runtime?: IngressRuntimeTrace;
  agent?: IngressAgentTrace;
  toolCalls: IngressToolCallTrace[];
  memory: IngressMemoryTrace[];
  handoffs: IngressHandoffTrace[];
  businessArtifacts: IngressBusinessArtifactTrace[];
  errors: IngressErrorTrace[];
  startedAt: number;
  finishedAt?: number;
}

export interface IngressResult {
  reply: string;
  trace: IngressTrace;
}
