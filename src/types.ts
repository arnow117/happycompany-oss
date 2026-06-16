export type MessageSource = 'user' | 'bot' | 'self';

export interface FileAttachment {
  type: 'file' | 'image';
  name: string;
  localPath: string;
  mimeType?: string;
  textContent?: string;
  base64?: string;
}

export interface NormalizedMessage {
  id: string;
  chatId: string;
  text: string;
  source: MessageSource;
  channelId: string;
  fromBotName?: string;
  receivedAt: number;
  fromUserId?: string;
  createTimeMs?: number;
  threadId?: string;
  rootId?: string;
  parentId?: string;
  chatType?: 'group' | 'p2p';
  mentions?: Array<{ key?: string; name?: string; id?: { open_id?: string } }>;
  replyTo?: {
    messageId: string;
    text: string;
    files?: FileAttachment[];
  };
  files?: FileAttachment[];
}

export interface BotConfig {
  name: string;
  channel: 'feishu' | 'dingtalk' | 'web';
  credentials?: Record<string, string>;
  displayName: string;
  reactionEmoji?: string;
  agentDir: string;
  cwd?: string;
  model?: string;
  baseUrl?: string;
  authToken?: string;
  hidden?: boolean;
  tenant?: string;
  routingMode?: 'direct' | 'employee-director';
  groupReplyMode?: 'mention-only' | 'all';
}

import type { RiskLevel, ToolDef, AppJson } from './tool-schemas.js';
export type { ToolManifest, AppJson } from './tool-schemas.js';

export interface RegisteredTool extends ToolDef {
  namespacedName: string;
  skillName: string;
  skillDir: string;
  appName: string;
  tenantName: string;
  hasServer: boolean;
}

export interface SkillSummary {
  name: string;
  displayName: string;
  description: string;
  toolCount: number;
  hasServer: boolean;
}

export type AppSummary = SkillSummary;

export interface RegisteredSkillServer {
  tenantName: string;
  skillName: string;
  appName: string;
  cwd: string;
  entry: string;
  python?: string;
}

export type RegisteredAppServer = RegisteredSkillServer;
