import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolRegistry } from './tool-registry.js';
import type { EmployeeDefinition } from './orchestrator/employee-schema.js';
import type { LoadedEmployee } from './orchestrator/employee-loader.js';

export interface CapabilitySkill {
  name: string;
  displayName: string;
  description: string;
  installed: boolean;
  toolCount: number;
  allowed: boolean;
  reason?: string;
}

export interface CapabilityTool {
  name: string;
  appName: string;
  description: string;
  riskLevel: string;
  registered: boolean;
  allowed: boolean;
  requiresConfirmation?: boolean;
  reason?: string;
}

export interface CapabilityHandoffTarget {
  employeeId: string;
  displayName?: string;
  exists: boolean;
}

export interface EmployeeCapabilityReport {
  tenant: string;
  employeeId: string;
  displayName: string;
  role: string;
  workspace: {
    relative: string;
    absolute: string;
    hasClaudeMd: boolean;
  };
  promptSource: {
    yamlSystemPrompt: boolean;
    workspaceClaudeMd: boolean;
  };
  capabilities: string[];
  skills: CapabilitySkill[];
  tools: CapabilityTool[];
  handoffTargets: CapabilityHandoffTarget[];
  mcpBoundary: {
    platformMcpVisible: boolean;
    businessMcpDirectVisible: boolean;
    businessInterface: 'run_skill' | 'skill-tools-legacy';
  };
  summary: {
    skillCount: number;
    toolCount: number;
    allowedToolCount: number;
    highRiskToolCount: number;
    handoffTargetCount: number;
    warningCount: number;
  };
  warnings: string[];
}

export interface CapabilityRegistryDeps {
  corpDir: string;
  toolRegistry: ToolRegistry;
  employees: LoadedEmployee[];
}

function isHighRisk(riskLevel: string): boolean {
  return riskLevel === 'internal_write' || riskLevel === 'destructive' || riskLevel === 'external';
}

function toEmployeeDefinition(employee: LoadedEmployee): EmployeeDefinition {
  return employee;
}

export class CapabilityRegistry {
  constructor(private readonly deps: CapabilityRegistryDeps) {}

  list(tenant?: string): EmployeeCapabilityReport[] {
    return this.deps.employees
      .filter((employee) => !tenant || employee.tenantName === tenant)
      .map((employee) => this.reportFor(toEmployeeDefinition(employee), employee.tenantName));
  }

  get(tenant: string, employeeId: string): EmployeeCapabilityReport | null {
    const employee = this.deps.employees.find((item) => item.tenantName === tenant && item.id === employeeId);
    return employee ? this.reportFor(toEmployeeDefinition(employee), employee.tenantName) : null;
  }

  preview(tenant: string, employee: EmployeeDefinition): EmployeeCapabilityReport {
    return this.reportFor(employee, tenant);
  }

  private reportFor(employee: EmployeeDefinition, tenant: string): EmployeeCapabilityReport {
    const tenantEmployees = this.deps.employees.filter((item) => item.tenantName === tenant);
    const workspaceRelative = employee.workspace || `agents/${employee.id}`;
    const workspaceAbsolute = resolve(this.deps.corpDir, tenant, workspaceRelative);
    const claudeMdPath = join(workspaceAbsolute, 'CLAUDE.md');
    const warnings: string[] = [];

    if (!existsSync(claudeMdPath)) warnings.push('workspace CLAUDE.md is missing');

    const skills = employee.skills.map((skillName) => {
      const skill = this.deps.toolRegistry.getSkillSummaries(tenant).find((item) => item.name === skillName);
      const skillMdPath = join(this.deps.corpDir, tenant, '.claude', 'skills', skillName, 'SKILL.md');
      const installed = Boolean(skill) || existsSync(skillMdPath);
      if (!installed) warnings.push(`skill "${skillName}" is not installed`);
      return {
        name: skillName,
        displayName: skill?.displayName ?? skillName,
        description: skill?.description ?? '',
        installed,
        toolCount: skill?.toolCount ?? this.deps.toolRegistry.getSkillTools(tenant, skillName).length,
        allowed: installed,
      };
    });

    const toolNames = new Set(employee.tools);

    const tools = Array.from(toolNames).sort().map((toolName) => {
      const registered = this.deps.toolRegistry.lookup(tenant, toolName);
      if (!registered) {
        warnings.push(`tool "${toolName}" is not registered`);
        return {
          name: toolName,
          appName: toolName.split(':')[0] ?? '',
          description: '',
          riskLevel: 'unknown',
          registered: false,
          allowed: false,
          reason: 'Tool is not registered',
        };
      }
      if (isHighRisk(registered.riskLevel)) warnings.push(`${toolName} is ${registered.riskLevel}`);
      return {
        name: registered.namespacedName,
        appName: registered.appName,
        description: registered.description,
        riskLevel: registered.riskLevel,
        registered: true,
        allowed: true,
        requiresConfirmation: isHighRisk(registered.riskLevel),
      };
    });

    const handoffTargets = employee.allowedTargets.map((target) => {
      const found = tenantEmployees.find((item) => item.id === target);
      if (!found) warnings.push(`handoff target "${target}" does not exist`);
      return {
        employeeId: target,
        displayName: found?.displayName,
        exists: Boolean(found),
      };
    });

    return {
      tenant,
      employeeId: employee.id,
      displayName: employee.displayName,
      role: employee.role,
      workspace: {
        relative: workspaceRelative,
        absolute: workspaceAbsolute,
        hasClaudeMd: existsSync(claudeMdPath),
      },
      promptSource: {
        yamlSystemPrompt: employee.systemPrompt.trim().length > 0,
        workspaceClaudeMd: existsSync(claudeMdPath),
      },
      capabilities: employee.capabilities,
      skills,
      tools,
      handoffTargets,
      mcpBoundary: {
        platformMcpVisible: true,
        businessMcpDirectVisible: false,
        businessInterface: 'run_skill',
      },
      summary: {
        skillCount: skills.length,
        toolCount: tools.length,
        allowedToolCount: tools.filter((tool) => tool.allowed).length,
        highRiskToolCount: tools.filter((tool) => isHighRisk(tool.riskLevel)).length,
        handoffTargetCount: handoffTargets.length,
        warningCount: warnings.length,
      },
      warnings,
    };
  }
}
