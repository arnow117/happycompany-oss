import { HandoffRequest } from './handoff.js';

/** Tool-use event surfaced from an agent run so the orchestrator can observe it. */
export interface ToolUseEvent {
  phase: 'start' | 'end';
  toolName: string;
  toolUseId: string;
  elapsedMs?: number;
}

export interface AgentProtocol {
  readonly name: string;
  /**
   * @param onToolUse optional sink for tool-use events fired during the run, so
   *   orchestrated tool calls become observable upstream (ingress trace, etc.).
   */
  execute(
    inputText: string,
    context?: Record<string, unknown>,
    onToolUse?: (event: ToolUseEvent) => void,
  ): Promise<AgentResponse>;
}

export class AgentResponse {
  readonly text: string;
  readonly handoff: HandoffRequest | null;
  readonly done: boolean;
  readonly data: Record<string, unknown>;

  constructor(
    text: string,
    handoff: HandoffRequest | null,
    done: boolean,
    data: Record<string, unknown>,
  ) {
    this.text = text;
    this.handoff = handoff;
    this.done = done;
    this.data = data;
  }
}

// ── Employee generator types ──────────────────────────────

export interface FeishuQASkill {
  skillId: string;
  name: string;
  description: string;
  chatId: string;
  prompt: string;
}

export interface FormFallback {
  workflowId: string;
  name: string;
  steps: Array<{
    stepId: string;
    type: 'form' | 'approval' | 'notification' | 'document';
    title: string;
    assigneeRole: string;
    fields: Array<{
      key: string;
      label: string;
      type: 'text' | 'textarea' | 'select' | 'date' | 'file' | 'signature';
      required: boolean;
      options?: string[];
    }>;
    condition?: string;
  }>;
  status: 'ai-suggested' | 'user-confirmed' | 'active';
}

export interface GenerationResult {
  agent: {
    id: string;
    displayName: string;
    description: string;
    model: string;
    systemPrompt: string;
    tools: string[];
    skills: string[];
    role: string;
    capabilities: string[];
    workspace: string;
    source: 'generated' | 'prepopulated' | 'forked';
    createdAt: number;
    hasFallbackLevel1: boolean;
    hasFallbackLevel2: boolean;
    toolCount: number;
    skillCount: number;
    tenantName?: string;
  };
  warnings: string[];
  rawYaml: string;
  fallbackLevel1?: FeishuQASkill;
  fallbackLevel2?: FormFallback;
}

export interface OptimizationResult {
  id: string;
  displayName: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  rationale: string;
  originalAgentIds: string[];
}

export interface AgentGraphNode {
  id: string;
  label: string;
  type: 'agent' | 'tool' | 'skill' | 'fallback' | 'human';
  agentId?: string;
}

export interface AgentGraphEdge {
  source: string;
  target: string;
  label?: string;
  type: 'data-flow' | 'handoff' | 'fallback' | 'tool-call';
}

export interface AgentGraph {
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export interface GeneratedSkill {
  id: string;
  name: string;
  description: string;
  source: 'generated' | 'existing';
  tenantSkillPath: string;
  installedWorkdirs: string[];
}
