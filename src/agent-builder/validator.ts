import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ToolRegistry } from '../tool-registry.js';
import type { AgentBuilderIssue, AgentDraft } from './schema.js';
import { agentDraftSchema } from './schema.js';

export interface AgentDraftValidatorDeps {
  corpDir: string;
  toolRegistry: ToolRegistry;
  employeeExists?: (tenant: string, employeeId: string) => boolean;
}

export interface AgentDraftValidation {
  ok: boolean;
  issues: AgentBuilderIssue[];
}

function issue(severity: AgentBuilderIssue['severity'], field: string, message: string): AgentBuilderIssue {
  return { severity, field, message };
}

function isSafeSegment(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function workspacePath(corpDir: string, tenant: string, workspace: string): string {
  return isAbsolute(workspace) ? resolve(workspace) : resolve(corpDir, tenant, workspace);
}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export class AgentDraftValidator {
  constructor(private readonly deps: AgentDraftValidatorDeps) {}

  validate(draft: AgentDraft): AgentDraftValidation {
    const issues: AgentBuilderIssue[] = [];
    const parsed = agentDraftSchema.safeParse(draft);
    if (!parsed.success) {
      return {
        ok: false,
        issues: [issue('error', 'draft', parsed.error.message)],
      };
    }

    const tenantDir = join(this.deps.corpDir, draft.tenant);
    if (!existsSync(tenantDir)) {
      issues.push(issue('error', 'tenant', `Tenant does not exist: ${draft.tenant}`));
    }
    if (!isSafeSegment(draft.employee.id)) {
      issues.push(issue('error', 'employee.id', 'Employee id must be lowercase alphanumeric with hyphens'));
    }
    if (this.deps.employeeExists?.(draft.tenant, draft.employee.id)) {
      issues.push(issue('error', 'employee.id', `Employee already exists: ${draft.employee.id}`));
    }
    if (!draft.employee.systemPrompt.trim()) {
      issues.push(issue('error', 'employee.systemPrompt', 'systemPrompt is required'));
    }

    for (const skill of draft.employee.skills) {
      if (this.deps.toolRegistry.getSkillTools(draft.tenant, skill).length === 0) {
        const skillPath = join(this.deps.corpDir, draft.tenant, '.claude', 'skills', skill, 'SKILL.md');
        if (!existsSync(skillPath)) {
          issues.push(issue('error', 'employee.skills', `Skill does not exist: ${skill}`));
        }
      }
    }

    for (const toolName of draft.employee.tools) {
      const registered = this.deps.toolRegistry.lookup(draft.tenant, toolName);
      if (!registered) {
        issues.push(issue('error', 'employee.tools', `Tool is not registered: ${toolName}`));
        continue;
      }
      if (registered.riskLevel === 'destructive' || registered.riskLevel === 'external' || registered.riskLevel === 'internal_write') {
        issues.push(issue('warning', 'employee.tools', `${toolName} is ${registered.riskLevel}`));
      }
    }

    for (const target of draft.employee.allowedTargets) {
      if (!this.deps.employeeExists?.(draft.tenant, target)) {
        issues.push(issue('error', 'employee.allowedTargets', `Handoff target does not exist in tenant ${draft.tenant}: ${target}`));
      }
    }

    const tenantReal = resolve(tenantDir);
    const workspace = workspacePath(this.deps.corpDir, draft.tenant, draft.employee.workspace);
    const workspaceParent = resolve(workspace);
    if (!isInside(tenantReal, workspaceParent)) {
      issues.push(issue('error', 'employee.workspace', 'Workspace must stay inside the tenant directory'));
    }
    if (draft.employee.workspace.includes('..')) {
      issues.push(issue('error', 'employee.workspace', 'Workspace must not contain ..'));
    }

    return { ok: issues.every((item) => item.severity !== 'error'), issues };
  }
}
