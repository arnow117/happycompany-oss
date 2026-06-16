import { query, type Options, type SDKMessage, type McpSdkServerConfigWithInstance, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger.js';
import { resolve } from 'node:path';
import { PREDEFINED_AGENTS } from './sub-agents.js';
import { sanitizeEnv } from './env-guard.js';
import type {
  AgentObservabilityInit,
  AgentObservabilityUsage,
  AgentObservabilitySummary,
} from './agent-observability.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

export interface AgentOptions {
  name: string;
  /** Local management dir: stores session json + fallback persona. */
  agentDir: string;
  /** Real cwd Claude Code runs in. Defaults to agentDir. */
  cwd?: string;
  model?: string;
  /** Per-bot Anthropic API base URL (overrides process.env). */
  baseUrl?: string;
  /** Per-bot Anthropic auth token (overrides process.env). */
  authToken?: string;
  /** MCP servers to inject. Keyed by server name (e.g. "platform", "tenant-tools"). */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
}

export interface RespondOptions {
  /**
   * Invoked every time the accumulated reply text grows (at each assistant
   * turn or partial text delta). Used by Feishu streaming card to render
   * a typewriter effect. Throws are caught and logged.
   */
  onText?: (accumulatedText: string) => void;
  /**
   * Invoked when Claude starts using a tool. The handler should update
   * the UI (e.g. streaming-card auxiliary status line).
   * toolInput is provided when available from the tool_use block.
   */
  onToolStart?: (info: { toolName: string; toolUseId: string; toolInput?: Record<string, unknown> }) => void;
  /**
   * Invoked when a tool finishes. `elapsedMs` comes from the SDK.
   */
  onToolEnd?: (info: { toolName: string; toolUseId: string; elapsedMs: number }) => void;
  /** Invoked when SDK init metadata is available for the turn. */
  onInit?: (info: AgentObservabilityInit) => void;
  /** Invoked when SDK final result usage/cost metadata is available. */
  onUsage?: (info: AgentObservabilityUsage) => void;
  /** Invoked when SDK final result status is available. */
  onResultSummary?: (info: AgentObservabilitySummary) => void;
  /**
   * AbortController for this query. Calling `.abort()` interrupts the
   * running agent (the stream returns early, promise resolves with whatever
   * text was accumulated up to that point).
   */
  abortController?: AbortController;
  /**
   * Max wall-clock time for a single respond() call. Defaults to 5 minutes.
   * After timeout the query is aborted and interrupt() is called to clean up
   * SDK subprocesses.
   */
  timeoutMs?: number;
  /**
   * Optional per-call MCP server override map. When provided, merged
   * with (and overrides) constructor-level mcpServers.
   */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  /** Optional user ID for per-user session isolation within the same chat. */
  userId?: string;
  /**
   * SDK-native permission hook. Called before each tool execution.
   * When provided, replaces the default bypassPermissions mode.
   */
  canUseTool?: CanUseTool;
  /**
   * Restrict which built-in tools are visible to the model. When set, only
   * the listed tools appear in the model's context — everything else is
   * completely hidden (not just denied at call-time).
   * Example: `['Bash', 'Skill']` hides Read/Write/Edit/Grep/etc.
   */
  tools?: string[];
  /**
   * Skills to enable for this request. When a tenant auth gate is active,
   * set to the user's allowed skill names. `'all'` means all discovered skills.
   */
  skills?: string[] | 'all';
}

/**
 * Thin wrapper around Claude Agent SDK's query() -- one agent per bot persona.
 * Sessions are persisted to disk per (agentDir, chatId) so the same bot in
 * different chats keeps separate conversation state.
 */
export class ClaudeAgent {
  private readonly agentDir: string;
  private cwd: string;
  private readonly sessionIds = new Map<string, string>();

  constructor(private readonly opts: AgentOptions) {
    this.agentDir = resolve(process.cwd(), opts.agentDir);
    mkdirSync(this.agentDir, { recursive: true });
    this.cwd = opts.cwd ? resolve(process.cwd(), opts.cwd) : this.agentDir;
    if (opts.cwd) {
      mkdirSync(this.cwd, { recursive: true });
    }
    this.loadSessions();
  }

  private sessionFilePath(sessionKey: string): string {
    const safe = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return resolve(this.agentDir, `.session-${safe}.json`);
  }

  async respond(
    prompt: string,
    chatId: string,
    respOpts: RespondOptions = {},
  ): Promise<string> {
    const sessionKey = respOpts.userId ? `${respOpts.userId}:${chatId}` : chatId;
    const sessionId = this.sessionIds.get(sessionKey) ?? null;

    // Persona: ALWAYS injected from agentDir/CLAUDE.md, independent of cwd.
    // This way the bot's identity doesn't change when cwd points at a
    // different project directory (which may or may not have its own CLAUDE.md).
    const personaPath = resolve(this.agentDir, 'CLAUDE.md');
    let personaText = '';
    try {
      personaText = readFileSync(personaPath, 'utf-8');
    } catch {
      // persona file absent -- fall back to default prompt only
    }

    const sdkEnv = sanitizeEnv(process.env as Record<string, string>);
    if (this.opts.baseUrl) sdkEnv.ANTHROPIC_BASE_URL = this.opts.baseUrl;
    if (this.opts.authToken) sdkEnv.ANTHROPIC_AUTH_TOKEN = this.opts.authToken;
    if (process.env.ANTHROPIC_MODEL) sdkEnv.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;

    const ac = respOpts.abortController ?? new AbortController();
    const timeoutMs = respOpts.timeoutMs ?? 5 * 60 * 1000;
    const timer = setTimeout(() => {
      logger.warn({ bot: this.opts.name, chatId, timeoutMs }, 'Agent respond timed out, aborting');
      ac.abort();
    }, timeoutMs);

    const options: Options = {
      cwd: this.cwd,
      settingSources: ['project'],
      ...(respOpts.canUseTool
        ? { canUseTool: respOpts.canUseTool }
        : { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }),
      ...(respOpts.skills ? { skills: respOpts.skills } : {}),
      ...(respOpts.tools ? { tools: respOpts.tools } : {}),
      includePartialMessages: true,
      agents: PREDEFINED_AGENTS,
      env: sdkEnv,
      ...(personaText
        ? {
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: personaText,
            },
          }
        : {}),
      ...(this.opts.model ? { model: this.opts.model } : {}),
      ...(sessionId ? { resume: sessionId } : {}),
      abortController: ac,
      ...(respOpts.mcpServers ?? this.opts.mcpServers
        ? { mcpServers: { ...(this.opts.mcpServers ?? {}), ...(respOpts.mcpServers ?? {}) } }
        : {}),
    };

    logger.info(
      {
        bot: this.opts.name,
        chatId,
        sessionKey,
        resume: sessionId !== null,
        promptLen: prompt.length,
        cwd: this.cwd,
        personaBytes: personaText.length,
      },
      'agent.respond start',
    );

    const q = query({ prompt, options });
    let accumulatedText = '';
    let newSessionId: string | null = null;

    const fireOnText = (text: string): void => {
      if (!respOpts.onText) return;
      try {
        respOpts.onText(text);
      } catch (err) {
        logger.warn({ err, bot: this.opts.name }, 'onText callback threw');
      }
    };

    try {
      for await (const msg of q) {
        const captured = extractSessionId(msg);
        if (captured) {
          newSessionId = captured;
        }

        const init = extractInitInfo(msg);
        if (init) {
          try {
            respOpts.onInit?.(init);
          } catch (err) {
            logger.warn({ err, bot: this.opts.name }, 'onInit threw');
          }
        }

        // Streaming partial text deltas (typewriter source).
        const delta = extractStreamTextDelta(msg);
        if (delta) {
          accumulatedText += delta;
          fireOnText(accumulatedText);
          continue;
        }

        // Full turn boundary -- supersedes accumulation for this turn.
        const turnText = extractAssistantTurnText(msg);
        if (turnText) {
          accumulatedText = turnText;
          fireOnText(accumulatedText);
        }

        // Tool-use blocks inside an assistant message: fire onToolStart
        const toolUses = extractToolUses(msg);
        for (const tu of toolUses) {
          try {
            respOpts.onToolStart?.({ toolName: tu.name, toolUseId: tu.id, toolInput: tu.input });
          } catch (err) {
            logger.warn({ err, bot: this.opts.name }, 'onToolStart threw');
          }
        }

        // Tool-progress / summary events
        if (msg.type === 'tool_progress') {
          const m = msg as unknown as { tool_name?: string; tool_use_id?: string; elapsed_time_seconds?: number };
          if (m.tool_name && m.tool_use_id) {
            try {
              respOpts.onToolEnd?.({
                toolName: m.tool_name,
                toolUseId: m.tool_use_id,
                elapsedMs: Math.round((m.elapsed_time_seconds ?? 0) * 1000),
              });
            } catch (err) {
              logger.warn({ err, bot: this.opts.name }, 'onToolEnd threw');
            }
          }
        }

        // Final result message -- use as authoritative final if provided.
        const result = extractResultText(msg);
        if (result) {
          accumulatedText = result;
          fireOnText(accumulatedText);
        }
        const usage = extractUsageInfo(msg);
        if (usage) {
          try {
            respOpts.onUsage?.(usage);
          } catch (err) {
            logger.warn({ err, bot: this.opts.name }, 'onUsage threw');
          }
        }
        const resultSummary = extractResultSummary(msg);
        if (resultSummary) {
          try {
            respOpts.onResultSummary?.(resultSummary);
          } catch (err) {
            logger.warn({ err, bot: this.opts.name }, 'onResultSummary threw');
          }
        }
      }
    } finally {
      clearTimeout(timer);
      const queryObj = q as unknown as { interrupt?: () => Promise<void>; close?: () => void };
      // interrupt() sends a control message to stop the current query but does NOT
      // terminate the subprocess. close() sends EOF on stdin, causing the subprocess
      // to exit and freeing OS resources. Both must be called to prevent leaks.
      if (typeof queryObj.interrupt === 'function') {
        try {
          await queryObj.interrupt().catch(() => {});
        } catch {
          // interrupt may throw synchronously if SDK already cleaned up
        }
      }
      if (typeof queryObj.close === 'function') {
        try {
          queryObj.close();
        } catch {
          // close is sync and shouldn't throw, but guard anyway
        }
      }
    }

    if (newSessionId) {
      this.sessionIds.set(sessionKey, newSessionId);
      this.saveSession(sessionKey, newSessionId);
    }

    logger.info(
      { bot: this.opts.name, chatId, sessionKey, replyLen: accumulatedText.length },
      'agent.respond done',
    );
    return accumulatedText;
  }

  private loadSessions(): void {
    try {
      const files = readdirSync(this.agentDir);
      for (const name of files) {
        const m = name.match(/^\.session-(.+)\.json$/);
        if (!m) continue;
        const chatKey = m[1]!;
        try {
          const raw = readFileSync(resolve(this.agentDir, name), 'utf-8');
          const parsed = JSON.parse(raw) as { sessionId?: string };
          if (parsed.sessionId) this.sessionIds.set(chatKey, parsed.sessionId);
        } catch {
          // ignore corrupt session
        }
      }
    } catch {
      // agentDir may not exist yet
    }
  }

  private saveSession(sessionKey: string, sessionId: string): void {
    try {
      writeFileSync(
        this.sessionFilePath(sessionKey),
        JSON.stringify({ sessionId }, null, 2),
      );
    } catch (err) {
      logger.warn({ err, bot: this.opts.name, sessionKey }, 'Failed to save session');
    }
  }

  /**
   * Clear the Claude session for a specific chat -- erases both the
   * persisted file and the in-memory sessionId cache. Returns true if
   * something was actually cleared (file existed or cache held a value).
   */
  clearSession(chatId: string, userId?: string): boolean {
    const sessionKey = userId ? `${userId}:${chatId}` : chatId;
    const hadMemory = this.sessionIds.delete(sessionKey);
    let hadFile = false;
    const p = this.sessionFilePath(sessionKey);
    try {
      if (existsSync(p)) {
        unlinkSync(p);
        hadFile = true;
      }
    } catch (err) {
      logger.warn({ err, bot: this.opts.name, chatId, sessionKey }, 'clearSession unlink failed');
    }
    if (hadMemory || hadFile) {
      logger.info(
        { bot: this.opts.name, chatId, sessionKey, hadMemory, hadFile },
        'Session cleared',
      );
    }
    return hadMemory || hadFile;
  }

  listSessions(): string[] {
    const ids: string[] = [];
    try {
      const files = readdirSync(this.agentDir);
      for (const name of files) {
        const m = name.match(/^\.session-(.+)\.json$/);
        if (m) ids.push(m[1]!);
      }
    } catch {
      // agentDir may not exist yet
    }
    return ids;
  }

  /** Clear all sessions for this agent. Used after app install or workdir change. */
  clearAllSessions(): number {
    let count = 0;
    const sessionKeys = [...this.sessionIds.keys()];
    for (const sessionKey of sessionKeys) {
      this.sessionIds.delete(sessionKey);
      const p = this.sessionFilePath(sessionKey);
      try {
        if (existsSync(p)) {
          unlinkSync(p);
          count++;
        }
      } catch (err) {
        logger.warn({ err, bot: this.opts.name, sessionKey }, 'clearAllSessions unlink failed');
      }
    }
    logger.info({ bot: this.opts.name, cleared: count }, 'All sessions cleared');
    return count;
  }

  /**
   * Hot-update cwd / model / baseUrl / authToken.
   * When cwd changes, all sessions are cleared to prevent stale context.
   */
  updateOptions(patch: { cwd?: string; model?: string; baseUrl?: string; authToken?: string }): void {
    if (patch.cwd !== undefined) {
      const nextCwd = patch.cwd
        ? resolve(process.cwd(), patch.cwd)
        : this.agentDir;
      if (nextCwd !== this.cwd) {
        this.clearAllSessions();
      }
      this.cwd = nextCwd;
      mkdirSync(nextCwd, { recursive: true });
    }
    if (patch.model !== undefined) {
      (this.opts as { model?: string }).model = patch.model || undefined;
    }
    if (patch.baseUrl !== undefined) {
      (this.opts as { baseUrl?: string }).baseUrl = patch.baseUrl || undefined;
    }
    if (patch.authToken !== undefined) {
      (this.opts as { authToken?: string }).authToken = patch.authToken || undefined;
    }
    logger.info(
      { bot: this.opts.name, cwd: this.cwd, model: this.opts.model, baseUrl: this.opts.baseUrl },
      'agent.updateOptions applied',
    );
  }
}

function extractSessionId(msg: SDKMessage): string | null {
  const m = msg as unknown as { session_id?: string };
  return m.session_id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function extractInitInfo(msg: SDKMessage): AgentObservabilityInit | null {
  if (msg.type !== 'system') return null;
  const m = msg as unknown as Record<string, unknown>;
  if (m.subtype !== 'init') return null;
  const sessionId = typeof m.session_id === 'string' ? m.session_id : '';
  const model = typeof m.model === 'string' ? m.model : '';
  const cwd = typeof m.cwd === 'string' ? m.cwd : '';
  if (!sessionId || !model) return null;
  const mcpServers = Array.isArray(m.mcp_servers)
    ? m.mcp_servers.flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = typeof item.name === 'string' ? item.name : '';
        const status = typeof item.status === 'string' ? item.status : '';
        return name ? [{ name, status }] : [];
      })
    : [];
  const plugins = Array.isArray(m.plugins)
    ? m.plugins.flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = typeof item.name === 'string' ? item.name : '';
        const path = typeof item.path === 'string' ? item.path : '';
        return name ? [{ name, path }] : [];
      })
    : [];
  return {
    sessionId,
    model,
    cwd,
    tools: readStringArray(m.tools),
    mcpServers,
    skills: readStringArray(m.skills),
    plugins,
    permissionMode: typeof m.permissionMode === 'string' ? m.permissionMode : '',
    claudeCodeVersion: typeof m.claude_code_version === 'string' ? m.claude_code_version : '',
  };
}

function extractResultText(msg: SDKMessage): string {
  if (msg.type === 'result') {
    const r = msg as unknown as { result?: unknown };
    if (typeof r.result === 'string') {
      return r.result;
    }
  }
  return '';
}

function extractResultSummary(msg: SDKMessage): AgentObservabilitySummary | null {
  if (msg.type !== 'result') return null;
  const r = msg as unknown as Record<string, unknown>;
  const isError = r.is_error === true;
  const errors = Array.isArray(r.errors)
    ? r.errors.filter((item): item is string => typeof item === 'string')
    : [];
  const permissionDenials = Array.isArray(r.permission_denials)
    ? r.permission_denials.flatMap((item) => {
        if (!isRecord(item)) return [];
        const toolName = typeof item.tool_name === 'string' ? item.tool_name : '';
        const toolUseId = typeof item.tool_use_id === 'string' ? item.tool_use_id : '';
        return toolName && toolUseId ? [{ toolName, toolUseId }] : [];
      })
    : [];
  return {
    status: isError ? 'failed' : 'completed',
    stopReason: typeof r.stop_reason === 'string' ? r.stop_reason : null,
    errors,
    permissionDenials,
  };
}

function extractUsageInfo(msg: SDKMessage): AgentObservabilityUsage | null {
  if (msg.type !== 'result') return null;
  const r = msg as unknown as Record<string, unknown>;
  const usage = isRecord(r.usage) ? r.usage : {};
  const inputTokens = readNumber(usage, 'input_tokens') ?? readNumber(usage, 'inputTokens') ?? 0;
  const outputTokens = readNumber(usage, 'output_tokens') ?? readNumber(usage, 'outputTokens') ?? 0;
  const cacheReadInputTokens = readNumber(usage, 'cache_read_input_tokens') ?? readNumber(usage, 'cacheReadInputTokens') ?? 0;
  const cacheCreationInputTokens = readNumber(usage, 'cache_creation_input_tokens') ?? readNumber(usage, 'cacheCreationInputTokens') ?? 0;
  const modelUsage: AgentObservabilityUsage['modelUsage'] = {};
  if (isRecord(r.modelUsage)) {
    for (const [model, value] of Object.entries(r.modelUsage)) {
      if (!isRecord(value)) continue;
      modelUsage[model] = {
        inputTokens: readNumber(value, 'inputTokens') ?? 0,
        outputTokens: readNumber(value, 'outputTokens') ?? 0,
        cacheReadInputTokens: readNumber(value, 'cacheReadInputTokens') ?? 0,
        cacheCreationInputTokens: readNumber(value, 'cacheCreationInputTokens') ?? 0,
        costUSD: readNumber(value, 'costUSD') ?? 0,
      };
    }
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    costUSD: readNumber(r, 'total_cost_usd') ?? 0,
    durationMs: readNumber(r, 'duration_ms') ?? 0,
    apiDurationMs: readNumber(r, 'duration_api_ms'),
    numTurns: readNumber(r, 'num_turns') ?? 0,
    modelUsage: Object.keys(modelUsage).length > 0 ? modelUsage : undefined,
  };
}

function extractAssistantTurnText(msg: SDKMessage): string {
  if (msg.type !== 'assistant') return '';
  const m = msg as unknown as {
    message?: { content?: unknown };
  };
  const content = m.message?.content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    const b = block as { type?: string; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
    }
  }
  return text;
}

function extractStreamTextDelta(msg: SDKMessage): string {
  if (msg.type !== 'stream_event') return '';
  const m = msg as unknown as {
    event?: {
      type?: string;
      delta?: { type?: string; text?: unknown };
    };
  };
  const ev = m.event;
  if (ev?.type !== 'content_block_delta') return '';
  if (ev.delta?.type !== 'text_delta') return '';
  if (typeof ev.delta.text !== 'string') return '';
  return ev.delta.text;
}

function extractToolUses(msg: SDKMessage): Array<{ name: string; id: string; input?: Record<string, unknown> }> {
  if (msg.type !== 'assistant') return [];
  const m = msg as unknown as {
    message?: { content?: unknown };
  };
  const content = m.message?.content;
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; id: string; input?: Record<string, unknown> }> = [];
  for (const block of content) {
    const b = block as { type?: string; name?: string; id?: string; input?: Record<string, unknown> };
    if (b.type === 'tool_use' && typeof b.name === 'string' && typeof b.id === 'string') {
      out.push({ name: b.name, id: b.id, input: b.input });
    }
  }
  return out;
}
