import fs from 'node:fs';
import path from 'node:path';
import { tool, createSdkMcpServer, type SdkMcpToolDefinition, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { RegisteredTool } from '../types.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { AppServerMgr } from '../app-server.js';
import type { EmployeeDefinition } from './employee-schema.js';
import type { WriteLockManager } from './write-lock.js';
import { ensureSkillServer } from './skill-server.js';
import { buildHandoffToolDef } from '../mcp-tools.js';
import { parseFrontmatter } from '../skills.js';
import { skillToolSchema, type SkillToolDef } from '../tool-schemas.js';
import { SkillToolBuilder, type BuiltTool } from '../skill-tool-builder.js';

export interface CallerContext {
  agentId: string;
  role: string;
  owner?: string;
}

export type ResolvedTool =
  | { registered: RegisteredTool; matchedPattern: string }
  | { builtTool: BuiltTool; matchedPattern: string };

export interface SkillBridgeOptions {
  toolRegistry: ToolRegistry;
  appServerMgr: AppServerMgr;
  corpDir: string;
  writeLockManager?: WriteLockManager;
  skillToolBuilder?: SkillToolBuilder;
}

export class SkillBridge {
  constructor(private readonly options: SkillBridgeOptions) {}

  resolveTools(app: EmployeeDefinition, tenantName: string): ResolvedTool[] {
    const tenantTools = this.options.toolRegistry.getToolsForTenant(tenantName);
    const patterns = [...app.tools];

    // Expand skills shorthand: ["med_crm"] → all tools from that skill
    const expandedBySkill = this.expandSkills(app.skills, tenantTools);
    const resolved = new Map<string, ResolvedTool>();

    // Resolve explicit tool patterns
    for (const pattern of patterns) {
      for (const t of tenantTools) {
        if (resolved.has(t.namespacedName)) continue;
        if (matchToolPattern(pattern, t.namespacedName)) {
          resolved.set(t.namespacedName, { registered: t, matchedPattern: pattern });
        }
      }
    }

    // Add skill-expanded tools (dedup by namespacedName)
    for (const t of expandedBySkill) {
      if (!resolved.has(t.namespacedName)) {
        resolved.set(t.namespacedName, { registered: t, matchedPattern: `skill:${t.skillName}` });
      }
    }

    // Fallback: resolve tools from SKILL.md frontmatter when tools.json yields nothing
    if (resolved.size === 0) {
      for (const bt of this.resolveToolsFromSkills(app, tenantName)) {
        if (!resolved.has(bt.name)) {
          resolved.set(bt.name, { builtTool: bt, matchedPattern: `skill:${bt.appName}` });
        }
      }
    }

    return Array.from(resolved.values());
  }

  buildMcpTools(
    app: EmployeeDefinition,
    tenantName: string,
    callerContext: CallerContext,
  ): SdkMcpToolDefinition<any>[] {
    const resolved = this.resolveTools(app, tenantName);
    return resolved.map((rt) => this.buildSingleTool(rt, callerContext));
  }

  buildMcpServer(
    app: EmployeeDefinition,
    tenantName: string,
    callerContext: CallerContext,
  ): McpSdkServerConfigWithInstance {
    const toolDefs = this.buildMcpTools(app, tenantName, callerContext);
    // Inject the handoff tool so colony agents can call it during orchestration
    toolDefs.push(buildHandoffToolDef());
    return createSdkMcpServer({
      name: `skill-tools:${app.id}`,
      version: '1.0.0',
      tools: toolDefs,
      alwaysLoad: true,
    });
  }

  private buildSingleTool(rt: ResolvedTool, callerContext: CallerContext): SdkMcpToolDefinition<any> {
    // SKILL.md-built tool path: no server/CLI dispatch, just a passthrough shell
    if ('builtTool' in rt) {
      const { builtTool } = rt;
      const inputShape = jsonSchemaToZodShape(builtTool.parameters);
      const sdkName = toSdkToolName(builtTool.name);
      return tool(
        sdkName,
        `${builtTool.description}\n\nInternal tool id: ${builtTool.name}`,
        inputShape,
        async () => ({
          content: [{ type: 'text' as const, text: `Skill tool ${builtTool.name} invoked (SKILL.md-defined, no server dispatch)` }],
        }),
      );
    }

    // Registered tool path (from tools.json): full server/CLI dispatch + write locks
    const { registered } = rt;
    const inputShape = jsonSchemaToZodShape(registered.parameters);
    const sdkName = toSdkToolName(registered.namespacedName);
    const appServerMgr = this.options.appServerMgr;
    const lockMgr = this.options.writeLockManager;
    const needsLock = lockMgr && (registered.riskLevel === 'internal_write' || registered.riskLevel === 'destructive');

    return tool(
      sdkName,
      `${registered.description}\n\nInternal tool id: ${registered.namespacedName}`,
      inputShape,
      async (args: Record<string, unknown>) => {
        try {
          // Write-lock check for mutating tools
          if (needsLock) {
            const result = lockMgr.acquire({ entity: registered.namespacedName, entityId: callerContext.agentId, lockedBy: callerContext.agentId });
            if (!result.acquired) {
              return {
                content: [{ type: 'text' as const, text: `Write lock denied: ${registered.namespacedName} is locked by ${result.heldBy}` }],
                isError: true,
              };
            }
          }
          const params = { ...args, callerContext };
          let result: unknown;

          if (registered.hasServer) {
            const serverKey = await ensureSkillServer(
              { appServerMgr, toolRegistry: this.options.toolRegistry, corpDir: this.options.corpDir },
              registered,
            );
            result = await appServerMgr.call(serverKey, registered.name, params);
          } else {
            result = await appServerMgr.callCli({
              cwd: registered.skillDir,
              command: registered.name,
              args: Object.entries(params).flatMap(([k, v]) => [`--${k}`, String(v)]),
            });
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Tool error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  /**
   * Fallback: resolve tools by reading SKILL.md frontmatter from
   * corp/{tenant}/.claude/skills/{skill}/SKILL.md and building via SkillToolBuilder.
   * Only used when tools.json yields no tools for this employee's skills.
   */
  private resolveToolsFromSkills(app: EmployeeDefinition, tenantName: string): BuiltTool[] {
    if (!this.options.skillToolBuilder || !app.skills?.length) return [];

    const skillsDir = path.join(this.options.corpDir, tenantName, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const allTools: BuiltTool[] = [];
    for (const skillName of app.skills) {
      const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const frontmatter = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf-8'));
      const toolsRaw = frontmatter['tools'];
      if (!Array.isArray(toolsRaw) || !toolsRaw.length) continue;

      const validatedDefs: SkillToolDef[] = [];
      for (const t of toolsRaw) {
        const parsed = skillToolSchema.safeParse(t);
        if (parsed.success) validatedDefs.push(parsed.data);
      }

      allTools.push(
        ...this.options.skillToolBuilder.buildToolsForSkill({ appName: skillName, toolDefs: validatedDefs }),
      );
    }
    return allTools;
  }

  private expandSkills(skills: string[], tenantTools: RegisteredTool[]): RegisteredTool[] {
    const expanded: RegisteredTool[] = [];
    for (const skillName of skills) {
      const skillTools = tenantTools.filter((t) => t.skillName === skillName);
      expanded.push(...skillTools);
    }
    return expanded;
  }
}

export function matchToolPattern(pattern: string, namespacedName: string): boolean {
  if (pattern === namespacedName) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // "med_crm:"
    return namespacedName.startsWith(prefix);
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(namespacedName);
  }
  return false;
}

export function toSdkToolName(namespacedName: string): string {
  return namespacedName.replace(/[^A-Za-z0-9_.-]/g, '.');
}

function jsonSchemaToZodShape(
  schema: { properties?: Record<string, unknown>; required?: string[] },
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  for (const [key] of Object.entries(props)) {
    shape[key] = required.has(key) ? z.string() : z.string().optional();
  }

  return shape;
}
