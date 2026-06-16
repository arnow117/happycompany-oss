import path from 'node:path';
import { existsSync } from 'node:fs';
import { tool, createSdkMcpServer, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { LoadedEmployee } from './employee-loader.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { AppServerMgr } from '../app-server.js';
import type { RegisteredTool } from '../types.js';
import { buildHandoffToolDef } from '../mcp-tools.js';
import { ensureSkillServer } from './skill-server.js';
import { logger } from '../logger.js';
import type { MemoryManager } from '../memory.js';

export interface SkillRunnerDeps {
  toolRegistry: ToolRegistry;
  appServerMgr: AppServerMgr;
  corpDir: string;
  memoryManager?: MemoryManager;
}

export interface SkillRunRequest {
  employee: LoadedEmployee;
  skill: string;
  command: string;
  args?: Record<string, unknown>;
}

export interface SkillRunResult {
  ok: boolean;
  skill: string;
  command: string;
  result?: unknown;
  error?: string;
}

export class SkillRunner {
  constructor(private readonly deps: SkillRunnerDeps) {}

  async run(request: SkillRunRequest): Promise<SkillRunResult> {
    const skill = request.skill.trim();
    const command = normalizeCommandName(skill, request.command);
    const args = request.args ?? {};
    const namespacedName = `${skill}:${command}`;
    const employeeId = request.employee.id;
    const tenantName = request.employee.tenantName;

    const denied = this.validateRequest(request.employee, skill, command);
    if (denied) {
      return { ok: false, skill, command, error: denied };
    }

    const registered = this.deps.toolRegistry.lookup(tenantName, namespacedName);
    if (!registered) {
      return { ok: false, skill, command, error: `未注册的 skill command: ${namespacedName}` };
    }

    try {
      const result = await this.callRegisteredTool(registered, {
        ...args,
        callerContext: { agentId: employeeId, role: request.employee.role },
      });
      logger.info(
        { tenantName, employeeId, skill, command, riskLevel: registered.riskLevel },
        'SkillRunner command succeeded',
      );
      return { ok: true, skill, command, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { tenantName, employeeId, skill, command, err: message },
        'SkillRunner command failed',
      );
      return { ok: false, skill, command, error: message };
    }
  }

  buildEmployeeMcpServer(employee: LoadedEmployee): McpSdkServerConfigWithInstance {
    const tools = [
      this.buildRunSkillTool(employee),
      ...this.buildMemoryTools(employee),
      buildHandoffToolDef(),
    ];

    return createSdkMcpServer({
      name: `employee-platform:${employee.id}`,
      version: '1.0.0',
      tools,
      alwaysLoad: true,
    });
  }

  listAvailableCommands(employee: LoadedEmployee): RegisteredTool[] {
    const allowedSkills = new Set(employee.skills);
    const allowedTools = new Set(employee.tools ?? []);
    return this.deps.toolRegistry
      .getToolsForTenant(employee.tenantName)
      .filter((toolDef) => allowedSkills.has(toolDef.skillName))
      .filter((toolDef) => allowedTools.size === 0 || allowedTools.has(toolDef.namespacedName));
  }

  private buildRunSkillTool(employee: LoadedEmployee) {
    return tool(
      'run_skill',
      [
        'Run one command from a skill explicitly bound to this digital employee.',
        'Use this for all tenant business data operations. Do not explore files or use shell commands.',
        'Pass argsJson as a JSON object string, for example {"keyword":"浙一"}.',
      ].join('\n'),
      {
        skill: z.string().describe('Bound skill name, for example med_crm'),
        command: z.string().describe('Command name from the skill, for example global_search'),
        args: z.record(z.string(), z.unknown()).optional().describe('Command arguments as an object'),
        argsJson: z.string().optional().describe('JSON object string with command arguments'),
      },
      async (args) => {
        const parsedArgs = parseToolArgs(args.args, args.argsJson);
        if (!parsedArgs.ok) {
          return {
            content: [{ type: 'text' as const, text: parsedArgs.error }],
            isError: true,
          };
        }

        const result = await this.run({
          employee,
          skill: args.skill,
          command: args.command,
          args: parsedArgs.value,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          isError: !result.ok,
        };
      },
    );
  }

  private buildMemoryTools(employee: LoadedEmployee) {
    const memory = this.deps.memoryManager;
    if (!memory) return [];

    return [
      tool(
        'memory_append',
        [
          'Append a note to this digital employee workspace memory.',
          'Use this for durable preferences, decisions, useful observations, and follow-up context.',
          'The platform scopes this tool to the current employee only.',
        ].join('\n'),
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
            memory.appendMemory(employee.id, content, date);
            return {
              content: [{ type: 'text' as const, text: `Memory appended to ${date ?? 'today'}.md` }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `Memory append failed: ${message}` }],
              isError: true,
            };
          }
        },
      ),
      tool(
        'memory_search',
        'Search this digital employee workspace memory.',
        {
          query: z.string().describe('Search query'),
          max_results: z.number().max(50).optional().describe('Max results (default: 20)'),
        },
        async ({ query, max_results }) => {
          const results = memory.searchMemory(employee.id, query, max_results);
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
    ];
  }

  private validateRequest(employee: LoadedEmployee, skill: string, command: string): string | null {
    if (!employee.skills.includes(skill)) {
      return `数字员工 ${employee.id} 未绑定 skill "${skill}"`;
    }

    if (!this.skillExists(employee.tenantName, skill)) {
      return `租户 ${employee.tenantName} 未安装 skill "${skill}"`;
    }

    if (!this.deps.toolRegistry.lookup(employee.tenantName, `${skill}:${command}`)) {
      return `skill "${skill}" 中未注册 command "${command}"`;
    }

    const toolName = `${skill}:${command}`;
    const allowedTools = employee.tools ?? [];
    if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      return `数字员工 ${employee.id} 未声明工具 "${toolName}"`;
    }

    return null;
  }

  private skillExists(tenantName: string, skill: string): boolean {
    const skillPath = path.join(this.deps.corpDir, tenantName, '.claude', 'skills', skill, 'SKILL.md');
    return existsSync(skillPath);
  }

  private async callRegisteredTool(registered: RegisteredTool, params: Record<string, unknown>): Promise<unknown> {
    return this.deps.appServerMgr.callCli({
      cwd: registered.skillDir,
      command: 'python3',
      args: ['-m', `${registered.skillName}.cli`, registered.name, ...toCliArgs(params)],
      env: this.buildAppEnv(registered),
      timeoutMs: 30_000,
    }).catch(async (err) => {
      if (!registered.hasServer) throw err;
      logger.warn(
        { skillName: registered.skillName, tool: registered.name, skillDir: registered.skillDir, err: err instanceof Error ? err.message : String(err) },
        'SkillRunner CLI call failed, falling back to skill server',
      );
      const serverKey = await ensureSkillServer(
        { appServerMgr: this.deps.appServerMgr, toolRegistry: this.deps.toolRegistry, corpDir: this.deps.corpDir },
        registered,
      );
      return this.deps.appServerMgr.call(serverKey, registered.name, params);
    });
  }

  private buildAppEnv(registered: RegisteredTool): Record<string, string> | undefined {
    if (registered.skillName !== 'med_crm') return undefined;
    const tenantDb = path.join(this.deps.corpDir, registered.tenantName, 'cdata', 'crm.db');
    const legacyDb = path.join(this.deps.corpDir, 'acme', 'cdata', 'crm.db');
    const dbPath = existsSync(tenantDb) ? tenantDb : existsSync(legacyDb) ? legacyDb : undefined;
    return dbPath ? { ACME_CRM_DB: dbPath } : undefined;
  }
}

function normalizeCommandName(skill: string, rawCommand: string): string {
  const command = rawCommand.trim();
  const colonPrefix = `${skill}:`;
  if (command.startsWith(colonPrefix)) return command.slice(colonPrefix.length);
  const dotPrefix = `${skill}.`;
  if (command.startsWith(dotPrefix)) return command.slice(dotPrefix.length);
  return command;
}

function parseToolArgs(
  args: Record<string, unknown> | undefined,
  raw: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (args) return { ok: true, value: args };
  return parseArgsJson(raw);
}

function parseArgsJson(raw: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || raw.trim() === '') return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'argsJson 必须是 JSON object string' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `argsJson 不是合法 JSON: ${message}` };
  }
}

function toCliArgs(params: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === 'callerContext') continue;
    if (value === undefined || value === null) continue;
    args.push(`--${toKebabCase(key)}`, String(value));
  }
  return args;
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
