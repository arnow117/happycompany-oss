import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TemplateLoader } from '../template-loader.js';
import type { EmployeeDefinition } from '../orchestrator/employee-schema.js';
import { employeeDefinitionSchema } from '../orchestrator/employee-schema.js';
import type { AgentDraft, CreateAgentDraftBody } from './schema.js';
import { sanitizeDraftId, sanitizeEmployeeId } from './schema.js';

export interface NaturalLanguageDraftGenerator {
  generate(prompt: string, tenant: string): Promise<Partial<EmployeeDefinition>>;
}

export interface DraftFactoryDeps {
  corpDir: string;
  generator?: NaturalLanguageDraftGenerator;
  findEmployee?: (tenant: string, employeeId: string) => EmployeeDefinition | null;
  listEmployees?: (tenant: string) => EmployeeDefinition[];
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function baseEmployee(id: string, overrides: Partial<EmployeeDefinition> = {}): EmployeeDefinition {
  return employeeDefinitionSchema.parse({
    id,
    displayName: overrides.displayName ?? '新数字员工',
    description: overrides.description ?? '',
    model: overrides.model ?? 'claude-sonnet-4-6',
    systemPrompt: overrides.systemPrompt ?? '',
    maxTurns: overrides.maxTurns ?? 50,
    tools: overrides.tools ?? [],
    skills: overrides.skills ?? [],
    workspace: overrides.workspace ?? `agents/${id}`,
    role: overrides.role ?? 'member',
    allowedTargets: overrides.allowedTargets ?? [],
    capabilities: overrides.capabilities ?? [],
    ...(overrides.humanUserId ? { humanUserId: overrides.humanUserId } : {}),
    ...(overrides.schedule ? { schedule: overrides.schedule } : {}),
    source: overrides.source ?? 'generated',
    createdAt: Date.now(),
  });
}

function makeDraft(
  tenant: string,
  source: AgentDraft['source'],
  employee: EmployeeDefinition,
  input?: AgentDraft['input'],
): AgentDraft {
  const draftId = sanitizeDraftId(`${source}-${employee.id}-${Date.now().toString(36)}`);
  return {
    id: draftId,
    tenant,
    source,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input,
    employee,
    validation: { ok: false, issues: [] },
  };
}

function heuristicFromPrompt(prompt: string): Partial<EmployeeDefinition> {
  const isQa = /质检|质量|工单/.test(prompt);
  const isFinance = /财务|开票|赔付|结算/.test(prompt);
  const role = isQa ? 'maintenance' : isFinance ? 'finance' : 'member';
  const id = isQa ? 'maintenance-qa' : sanitizeEmployeeId(prompt.slice(0, 24));
  return {
    id,
    displayName: isQa ? '售后质检员工' : '新数字员工',
    description: prompt,
    role,
    skills: /维修|工单|医院|客户|CRM|crm/.test(prompt) ? ['med_crm'] : [],
    tools: /维修|工单|医院|客户|CRM|crm/.test(prompt) ? ['med_crm:list_maintenance', 'med_crm:hospital_info'] : [],
    allowedTargets: /财务|开票|赔付|结算/.test(prompt) ? ['finance-wangwu'] : [],
    capabilities: ['质检', '工单', '售后'].filter((word) => prompt.includes(word)),
    systemPrompt: [
      '你是企业的数字员工。',
      `职责描述：${prompt}`,
      '优先使用已授权的 skill 和工具处理业务数据；信息不足时先追问，不编造关键业务字段。',
    ].join('\n'),
  };
}

export class AgentDraftFactory {
  constructor(private readonly deps: DraftFactoryDeps) {}

  async create(body: CreateAgentDraftBody): Promise<AgentDraft> {
    if (body.source === 'manual') return this.fromManual(body.tenant);
    if (body.source === 'natural_language') return this.fromNaturalLanguage(body.tenant, body.prompt);
    if (body.source === 'template') return this.fromTemplate(body.tenant, body.templateId, body.role);
    return this.fromFork(body.tenant, body.sourceEmployeeId);
  }

  private fromManual(tenant: string): AgentDraft {
    const id = nowId('employee');
    const employee = baseEmployee(id, {
      displayName: '新数字员工',
      systemPrompt: '你是企业数字员工。请根据职责边界处理用户请求。',
    });
    return makeDraft(tenant, 'manual', employee);
  }

  private async fromNaturalLanguage(tenant: string, prompt: string): Promise<AgentDraft> {
    const suggestion = this.deps.generator
      ? await this.deps.generator.generate(prompt, tenant)
      : heuristicFromPrompt(prompt);
    const id = sanitizeEmployeeId(suggestion.id ?? suggestion.displayName ?? nowId('employee'));
    const employee = baseEmployee(id, {
      ...suggestion,
      id,
      workspace: suggestion.workspace ?? `agents/${id}`,
    });
    return makeDraft(tenant, 'natural_language', employee, { naturalLanguage: prompt });
  }

  private fromTemplate(tenant: string, templateId: string, role: string): AgentDraft {
    const loader = new TemplateLoader(join(this.deps.corpDir, 'templates'));
    const detail = loader.loadDetailed(templateId);
    if (!detail) throw new Error(`Template not found: ${templateId}`);
    const roleTemplate = detail.roles[role];
    if (!roleTemplate) throw new Error(`Role not found in template: ${role}`);
    const id = sanitizeEmployeeId(`${role}-${Date.now().toString(36)}`);
    const employees = this.deps.listEmployees?.(tenant) ?? [];
    const targets = roleTemplate.handoffTargets
      .map((target) => employees.find((employee) => employee.role === target.role)?.id)
      .filter((target): target is string => Boolean(target));
    const employee = baseEmployee(id, {
      displayName: roleTemplate.displayName,
      description: roleTemplate.description,
      role: roleTemplate.role,
      skills: roleTemplate.skills,
      allowedTargets: targets,
      capabilities: [
        roleTemplate.displayName,
        roleTemplate.role,
        ...roleTemplate.prompt.responsibilities,
        ...roleTemplate.requiredCapabilities,
      ],
      systemPrompt: roleTemplate.renderedPrompt ?? [
        roleTemplate.prompt.identity,
        '职责:',
        ...roleTemplate.prompt.responsibilities.map((item) => `- ${item}`),
        '边界:',
        ...roleTemplate.prompt.boundaries.map((item) => `- ${item}`),
      ].join('\n'),
    });
    return makeDraft(tenant, 'template', employee, { templateId });
  }

  private fromFork(tenant: string, sourceEmployeeId: string): AgentDraft {
    const source = this.deps.findEmployee?.(tenant, sourceEmployeeId)
      ?? this.findEmployeeFromFile(tenant, sourceEmployeeId);
    if (!source) throw new Error(`Employee not found: ${sourceEmployeeId}`);
    const id = sanitizeEmployeeId(`${source.id}-fork-${Date.now().toString(36)}`);
    const employee = baseEmployee(id, {
      ...source,
      id,
      displayName: `${source.displayName} Copy`,
      workspace: `agents/${id}`,
      humanUserId: undefined,
      source: 'forked',
    });
    return makeDraft(tenant, 'fork', employee, { sourceEmployeeId });
  }

  private findEmployeeFromFile(tenant: string, employeeId: string): EmployeeDefinition | null {
    const file = join(this.deps.corpDir, tenant, 'employees', `${employeeId}.yaml`);
    if (!existsSync(file)) return null;
    const parsed = parseYaml(readFileSync(file, 'utf-8')) as unknown;
    return employeeDefinitionSchema.parse(parsed);
  }
}
