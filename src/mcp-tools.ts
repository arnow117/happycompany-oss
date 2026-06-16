import { tool, createSdkMcpServer, type SdkMcpToolDefinition, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { MemoryManager } from './memory.js';
import type { TaskScheduler } from './scheduler.js';
import type { MessageBus } from './bus.js';
import type { RegisteredTool, SkillSummary } from './types.js';

// ── Handoff tool ─────────────────────────────────────────────────
// Registered as an MCP tool so colony agents can call `handoff` to
// transfer work. The actual handoff is detected by the orchestration
// engine via onToolStart — the handler here is just a no-op ack.
export function buildHandoffToolDef(): SdkMcpToolDefinition<any> {
  return tool(
    'handoff',
    'Transfer your current task to another digital employee. Call this when you have completed your work and someone else needs to take over, or when you encounter a problem outside your capabilities. If you know which colleague should handle this, fill in target. Otherwise leave target empty and the dispatcher will find the right person.',
    {
      target: z
        .string()
        .optional()
        .describe(
          "Optional. The agent ID to handoff to (e.g. 'sales-zhangsan'). Leave empty for automatic routing.",
        ),
      task: z
        .string()
        .describe(
          'Description of what needs to be done next. Be specific — include relevant IDs, context, and the desired outcome.',
        ),
      context: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional. Additional structured context like {contractId: "...", priority: "high"}.'),
    },
    async ({ target, task }) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Handoff request acknowledged. Transferring task: "${task}"${target ? ` to ${target}` : ' for automatic routing'}.`,
          },
        ],
      };
    },
  );
}

/**
 * Context injected by the platform wiring (index.ts -> agent.ts -> here).
 */
export interface McpToolsContext {
  botName: string;
  chatId: string;
  memory: MemoryManager;
  bus?: MessageBus;
  scheduler?: TaskScheduler;
  onMemoryOp?: (info: {
    operation: 'append' | 'search' | 'read' | 'write';
    subject: string;
    workspace?: string;
    status?: 'ok' | 'error';
  }) => void;
}

/**
 * Build the array of platform tool definitions. Exported separately for
 * direct unit testing (the handler on each tool can be invoked with args).
 */
export function buildPlatformToolDefs(ctx: McpToolsContext): Array<SdkMcpToolDefinition<any>> {
  return [
    // ── 1. send_message ──────────────────────────────────────
    tool(
      'send_message',
      'Send a message to the current conversation. Use for proactive updates, status, or logging.',
      {
        text: z.string().describe('Message text to send'),
      },
      async ({ text }) => {
        if (ctx.bus) {
          ctx.bus.publish({
            type: 'agent_reply_sent',
            botName: ctx.botName,
            chatId: ctx.chatId,
            text,
          });
        }
        return {
          content: [{ type: 'text' as const, text: `Message sent: ${text}` }],
        };
      },
    ),

    // ── 2. schedule_task ─────────────────────────────────────
    tool(
      'schedule_task',
      'Create a scheduled task that runs a prompt on a cron schedule, fixed interval, or one-time delay.',
      {
        prompt: z.string().optional().describe('The prompt to execute when the task fires'),
        schedule_type: z.enum(['cron', 'interval', 'once']).describe('Schedule type'),
        schedule_value: z
          .string()
          .describe('Cron expression, ISO duration (e.g. PT1H), or ISO datetime for one-time'),
      },
      async ({ prompt, schedule_type, schedule_value }) => {
        if (!ctx.scheduler) {
          return {
            content: [{ type: 'text' as const, text: 'Scheduler not available' }],
            isError: true,
          };
        }
        const task = ctx.scheduler.createTask({
          name: `task-${Date.now()}`,
          botName: ctx.botName,
          scheduleType: schedule_type,
          scheduleValue: schedule_value,
          prompt: prompt ?? '',
        });
        return {
          content: [{ type: 'text' as const, text: `Task created with ID ${task.id}` }],
        };
      },
    ),

    // ── 3. list_tasks ────────────────────────────────────────
    tool(
      'list_tasks',
      'List all scheduled tasks for the current bot.',
      {},
      async () => {
        if (!ctx.scheduler) {
          return {
            content: [{ type: 'text' as const, text: 'Scheduler not available' }],
            isError: true,
          };
        }
        const tasks = ctx.scheduler.listTasks().filter((t) => t.botName === ctx.botName);
        if (tasks.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No tasks found' }],
          };
        }
        const lines = tasks.map(
          (t) =>
            `- [${t.id}] ${t.name} (${t.scheduleType}: ${t.prompt?.slice(0, 50) ?? 'N/A'}) ${t.enabled ? 'enabled' : 'disabled'}`,
        );
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      },
    ),

    // ── 4. cancel_task ───────────────────────────────────────
    tool(
      'cancel_task',
      'Cancel a scheduled task by ID.',
      {
        task_id: z.string().describe('Task ID to cancel'),
      },
      async ({ task_id }) => {
        if (!ctx.scheduler) {
          return {
            content: [{ type: 'text' as const, text: 'Scheduler not available' }],
            isError: true,
          };
        }
        const deleted = ctx.scheduler.deleteTask(task_id);
        if (!deleted) {
          return {
            content: [{ type: 'text' as const, text: `Task ${task_id} not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Task ${task_id} cancelled` }],
        };
      },
    ),

    // ── 5. memory_append ─────────────────────────────────────
    tool(
      'memory_append',
      "Append a note to today's memory file. Use for time-sensitive info like progress, decisions, meeting notes.",
      {
        content: z.string().max(16384).describe('Content to append (max 16KB)'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Date in YYYY-MM-DD format (default: today)'),
      },
      async ({ content, date }) => {
        try {
          ctx.memory.appendMemory(ctx.botName, content, date);
          ctx.onMemoryOp?.({
            operation: 'append',
            subject: ctx.botName,
            status: 'ok',
          });
          return {
            content: [{ type: 'text' as const, text: `Memory appended to ${date ?? 'today'}.md` }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.onMemoryOp?.({
            operation: 'append',
            subject: ctx.botName,
            status: 'error',
          });
          return {
            content: [{ type: 'text' as const, text: `Memory append failed: ${message}` }],
            isError: true,
          };
        }
      },
    ),

    // ── 6. memory_search ─────────────────────────────────────
    tool(
      'memory_search',
      'Search across all memory files for relevant information.',
      {
        query: z.string().describe('Search query'),
        max_results: z.number().max(50).optional().describe('Max results (default: 20)'),
      },
      async ({ query, max_results }) => {
        const results = ctx.memory.searchMemory(ctx.botName, query, max_results);
        ctx.onMemoryOp?.({
          operation: 'search',
          subject: ctx.botName,
          status: 'ok',
        });
        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No results found.' }],
          };
        }
        const lines = results.map((r) => `[${r.file}:${r.line}] ${r.context.trim()}`);
        return {
          content: [{ type: 'text' as const, text: lines.join('\n\n') }],
        };
      },
    ),

    // ── 7. get_inbox ─────────────────────────────────────────
    tool(
      'get_inbox',
      'Get and remove pending inbox messages (domain events, replies from humans). Returns array of events.',
      {},
      async () => {
        if (!ctx.bus) {
          return {
            content: [{ type: 'text' as const, text: 'Inbox not available (no bus connection).' }],
            isError: true,
          };
        }
        const events = ctx.bus.drainInbox(ctx.botName);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(events) }],
        };
      },
    ),

    // ── 8. list_inbox ────────────────────────────────────────
    tool(
      'list_inbox',
      'Preview pending inbox messages without removing them.',
      {},
      async () => {
        if (!ctx.bus) {
          return {
            content: [{ type: 'text' as const, text: 'Inbox not available (no bus connection).' }],
            isError: true,
          };
        }
        const events = ctx.bus.getInbox(ctx.botName);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(events) }],
        };
      },
    ),

    // ── 9. handoff ────────────────────────────────────────────
    buildHandoffToolDef(),
  ];
}

/**
 * Build an in-process MCP server named "platform" containing six tools
 * that give the Claude agent access to platform services (memory, scheduler, bus).
 *
 * Returns a McpSdkServerConfigWithInstance ready to pass as Options.mcpServers.
 */
export function buildPlatformMcpServer(ctx: McpToolsContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'platform',
    version: '1.0.0',
    tools: buildPlatformToolDefs(ctx),
    alwaysLoad: true,
  });
}

// --- Tenant MCP Server (progressive disclosure) ---

export interface TenantMcpContext {
  tenantName: string;
  summaries: SkillSummary[];
  onLoadSkillTools: (skillName: string) => Promise<RegisteredTool[]>;
}

export function buildSkillSummaryTools(
  summaries: SkillSummary[],
  onLoadSkillTools: (skillName: string) => Promise<RegisteredTool[]>,
): Array<SdkMcpToolDefinition<any>> {
  const skillTools = summaries.map(
    (s) =>
      tool(
        `skill:${s.name}`,
        `${s.displayName}: ${s.description} (${s.toolCount} tools available). Use _load_skill_tools("${s.name}") to activate.`,
        {},
        async () => {
          const loadedTools = await onLoadSkillTools(s.name);
          return {
            content: [{
              type: 'text' as const,
              text: `Skill "${s.name}" loaded with ${loadedTools.length} tools: ${loadedTools.map((t) => t.namespacedName).join(', ')}. You can now call these tools directly.`,
            }],
          };
        },
      ),
  );

  const loadTool = tool(
    '_load_skill_tools',
    'Load all tools from a specific skill to make them callable.',
    { skill_name: z.string().describe('Skill name to load (e.g. "med_crm")') },
    async ({ skill_name }) => {
      const loadedTools = await onLoadSkillTools(skill_name);
      if (loadedTools.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No tools found for skill "${skill_name}"` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Loaded ${loadedTools.length} tools from "${skill_name}":\n${loadedTools.map((t) => `- ${t.namespacedName}: ${t.description}`).join('\n')}`,
        }],
      };
    },
  );

  return [...skillTools, loadTool];
}

export const buildAppSummaryTools = buildSkillSummaryTools;

export function buildTenantMcpServer(
  tenantName: string,
  ctx: TenantMcpContext,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'tenant-tools',
    version: '1.0.0',
    tools: buildSkillSummaryTools(ctx.summaries, ctx.onLoadSkillTools),
    alwaysLoad: true,
  });
}
