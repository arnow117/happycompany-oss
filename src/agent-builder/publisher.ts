import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { EmployeeManager } from '../orchestrator/employee-colony.js';
import type { LoadedEmployee } from '../orchestrator/employee-loader.js';
import type { EmployeeDefinition } from '../orchestrator/employee-schema.js';
import { employeeDefinitionSchema } from '../orchestrator/employee-schema.js';
import { employeeWorkdirPath } from '../orchestrator/employee-org.js';
import { writeEmployeeClaudeMd } from '../orchestrator/employee-prompt.js';
import type { AgentDraft } from './schema.js';

export interface AgentDraftPublisherDeps {
  corpDir: string;
  employeeManager?: EmployeeManager;
}

export interface PublishResult {
  employee: EmployeeDefinition;
  yamlPath: string;
  workspacePath: string;
  colonyRegistered: boolean;
}

function employeeToYaml(def: EmployeeDefinition): string {
  return stringifyYaml({
    id: def.id,
    displayName: def.displayName,
    description: def.description,
    model: def.model || 'claude-sonnet-4-6',
    systemPrompt: def.systemPrompt,
    maxTurns: def.maxTurns ?? 50,
    tools: def.tools ?? [],
    skills: def.skills ?? [],
    workspace: def.workspace || `agents/${def.id}`,
    role: def.role || 'member',
    ...(def.humanUserId ? { humanUserId: def.humanUserId } : {}),
    allowedTargets: def.allowedTargets ?? [],
    capabilities: def.capabilities ?? [],
    ...(def.schedule ? { schedule: def.schedule } : {}),
    source: def.source ?? 'generated',
    createdAt: def.createdAt ?? Date.now(),
  });
}

export class AgentDraftPublisher {
  constructor(private readonly deps: AgentDraftPublisherDeps) {}

  publish(draft: AgentDraft): PublishResult {
    if (draft.status !== 'tested') {
      throw new Error('Draft must pass validation and harness test before publish');
    }
    const employee = employeeDefinitionSchema.parse(draft.employee);
    const tenantDir = join(this.deps.corpDir, draft.tenant);
    const employeesDir = join(tenantDir, 'employees');
    mkdirSync(employeesDir, { recursive: true });
    const yamlPath = join(employeesDir, `${employee.id}.yaml`);
    if (existsSync(yamlPath) || this.deps.employeeManager?.has(employee.id, draft.tenant)) {
      throw new Error(`Employee already exists: ${employee.id}`);
    }

    const workspacePath = employee.workspace
      ? join(tenantDir, employee.workspace)
      : employeeWorkdirPath(this.deps.corpDir, draft.tenant, employee.id);
    writeEmployeeClaudeMd(workspacePath, employee);
    writeFileSync(yamlPath, employeeToYaml(employee), 'utf-8');

    let colonyRegistered = false;
    if (this.deps.employeeManager) {
      const loaded: LoadedEmployee = {
        ...employee,
        tenantName: draft.tenant,
        filePath: yamlPath,
        loadedAtMs: Date.now(),
      };
      this.deps.employeeManager.register(loaded);
      colonyRegistered = true;
    }

    return { employee, yamlPath, workspacePath, colonyRegistered };
  }
}
