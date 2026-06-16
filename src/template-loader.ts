import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { templateSchema, type Template } from './template-schema.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  employeeCount: number;
  version?: string;
}

export interface TemplateLoadResult {
  template: Template;
  employeeYamls: Map<string, string>;
}

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  version?: string;
  businessObjects: string[];
  roles: string[];
  defaultWorkflows: string[];
  segments: string[];
  defaultRoleOrder: string[];
}

export interface RolePromptTemplate {
  identity: string;
  responsibilities: string[];
  boundaries: string[];
}

export interface HandoffTarget {
  role: string;
  when: string;
  contract?: string;
}

export interface RoleTemplate {
  id: string;
  industry: string;
  role: string;
  displayName: string;
  description: string;
  prompt: RolePromptTemplate;
  requiredCapabilities: string[];
  skills: string[];
  handoffTargets: HandoffTarget[];
  renderedPrompt?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  role: string;
  description: string;
  triggerExamples: string[];
  steps: string[];
  missingInfoPolicy: string;
  output?: Record<string, unknown>;
}

export interface ContractTemplate {
  id: string;
  fromRole: string;
  toRole: string;
  description: string;
  requiredFields: Record<string, string>;
  optionalFields: Record<string, string>;
}

export interface TemplateDetail extends TemplateLoadResult {
  industry?: IndustryTemplate;
  roles: Record<string, RoleTemplate>;
  workflows: Record<string, WorkflowTemplate>;
  contracts: Record<string, ContractTemplate>;
  versions: TemplateVersion[];
}

export interface TemplateVersion {
  id: string;
  label: string;
  createdAt: string;
  path: string;
}

export interface CloneTemplateOptions {
  id: string;
  name: string;
  description?: string;
}

export interface InstantiateOptions {
  nameMap?: Record<string, string>;
}

type TemplateKind = 'industry' | 'roles' | 'workflows' | 'contracts';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item)]));
}

function toIndustryTemplate(value: unknown): IndustryTemplate {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    description: asString(record.description),
    version: typeof record.version === 'string' ? record.version : undefined,
    businessObjects: asStringArray(record.businessObjects),
    roles: asStringArray(record.roles),
    defaultWorkflows: asStringArray(record.defaultWorkflows),
    segments: asStringArray(record.segments),
    defaultRoleOrder: asStringArray(record.defaultRoleOrder),
  };
}

function toHandoffTargets(value: unknown): HandoffTarget[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      role: asString(record.role),
      when: asString(record.when),
      contract: typeof record.contract === 'string' ? record.contract : undefined,
    };
  });
}

function toRoleTemplate(value: unknown): RoleTemplate {
  const record = asRecord(value);
  const prompt = asRecord(record.prompt);
  return {
    id: asString(record.id),
    industry: asString(record.industry),
    role: asString(record.role),
    displayName: asString(record.displayName),
    description: asString(record.description),
    prompt: {
      identity: asString(prompt.identity),
      responsibilities: asStringArray(prompt.responsibilities),
      boundaries: asStringArray(prompt.boundaries),
    },
    requiredCapabilities: asStringArray(record.requiredCapabilities),
    skills: asStringArray(record.skills),
    handoffTargets: toHandoffTargets(record.handoffTargets),
    renderedPrompt: typeof record.renderedPrompt === 'string' ? record.renderedPrompt : undefined,
  };
}

function toWorkflowTemplate(value: unknown): WorkflowTemplate {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    role: asString(record.role),
    description: asString(record.description),
    triggerExamples: asStringArray(record.triggerExamples),
    steps: asStringArray(record.steps),
    missingInfoPolicy: asString(record.missingInfoPolicy),
    output: Object.keys(asRecord(record.output)).length ? asRecord(record.output) : undefined,
  };
}

function toContractTemplate(value: unknown): ContractTemplate {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    fromRole: asString(record.fromRole),
    toRole: asString(record.toRole),
    description: asString(record.description),
    requiredFields: asStringRecord(record.requiredFields),
    optionalFields: asStringRecord(record.optionalFields),
  };
}

function stripRenderedPrompt(role: RoleTemplate): Record<string, unknown> {
  const { renderedPrompt: _renderedPrompt, ...cleanRole } = role;
  return cleanRole;
}

export class TemplateLoader {
  constructor(private readonly templatesDir: string) {}

  list(): TemplateMeta[] {
    const results: TemplateMeta[] = [];
    const industriesDir = path.join(this.templatesDir, 'industries');

    if (!fs.existsSync(industriesDir)) {
      logger.warn({ industriesDir }, 'industries directory does not exist');
      return results;
    }

    const entries = fs.readdirSync(industriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const templateJsonPath = path.join(industriesDir, entry.name, 'template.json');
      if (!fs.existsSync(templateJsonPath)) continue;

      try {
        const raw = fs.readFileSync(templateJsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const validated = templateSchema.parse(parsed);
        const rawIndustry = this.readYamlFile(path.join(industriesDir, entry.name, 'industry.yaml'));
        const industry = rawIndustry ? toIndustryTemplate(rawIndustry) : undefined;
        results.push({
          id: validated.id,
          name: validated.name,
          description: validated.description,
          employeeCount: validated.employees.length,
          version: industry?.version,
        });
      } catch (err) {
        logger.warn({ templateDir: entry.name, err }, 'Failed to parse template.json');
      }
    }

    return results;
  }

  load(id: string): TemplateLoadResult | null {
    const templatePath = path.join(this.templateRoot(id), 'template.json');
    if (!fs.existsSync(templatePath)) {
      logger.warn({ templateId: id }, 'Template not found');
      return null;
    }

    try {
      const raw = fs.readFileSync(templatePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const template = templateSchema.parse(parsed);

      const employeeYamls = new Map<string, string>();
      for (const emp of template.employees) {
        const yamlPath = path.join(this.templateRoot(id), emp.template);
        if (fs.existsSync(yamlPath)) {
          employeeYamls.set(emp.template, fs.readFileSync(yamlPath, 'utf-8'));
        } else {
          logger.warn({ templateId: id, file: emp.template }, 'Employee template file not found');
        }
      }

      return { template, employeeYamls };
    } catch (err) {
      logger.warn({ templateId: id, err }, 'Failed to load template');
      return null;
    }
  }

  loadDetailed(id: string): TemplateDetail | null {
    const base = this.load(id);
    if (!base) return null;

    const root = this.templateRoot(id);
    const rawIndustry = this.readYamlFile(path.join(root, 'industry.yaml'));
    const workflows = this.readYamlDir(root, 'workflows', toWorkflowTemplate);
    const contracts = this.readYamlDir(root, 'contracts', toContractTemplate);
    const rawRoles = this.readYamlDir(root, 'roles', toRoleTemplate);
    const roles = Object.fromEntries(Object.entries(rawRoles).map(([key, role]) => [
      key,
      { ...role, renderedPrompt: this.renderRolePrompt(role, workflows, contracts) },
    ]));

    return {
      ...base,
      industry: rawIndustry ? toIndustryTemplate(rawIndustry) : undefined,
      roles,
      workflows,
      contracts,
      versions: this.listVersions(id),
    };
  }

  saveIndustryTemplate(templateId: string, industry: IndustryTemplate): void {
    if (industry.id !== templateId) throw new Error('Industry id must match template id');
    this.writeTemplateYaml(templateId, 'industry', 'industry', industry);
  }

  saveRoleTemplate(templateId: string, roleId: string, role: RoleTemplate): void {
    this.writeTemplateYaml(templateId, 'roles', roleId, stripRenderedPrompt(role));
  }

  saveContractTemplate(templateId: string, contractId: string, contract: ContractTemplate): void {
    this.writeTemplateYaml(templateId, 'contracts', contractId, contract);
  }

  cloneTemplate(sourceId: string, options: CloneTemplateOptions): TemplateMeta {
    if (!this.safeSegment(sourceId) || !this.safeSegment(options.id)) throw new Error('Invalid template path');
    const sourceRoot = this.templateRoot(sourceId);
    const targetRoot = this.templateRoot(options.id);
    if (!fs.existsSync(sourceRoot)) throw new Error(`Template not found: ${sourceId}`);
    if (fs.existsSync(targetRoot)) throw new Error(`Template already exists: ${options.id}`);

    fs.cpSync(sourceRoot, targetRoot, { recursive: true });
    const templateJsonPath = path.join(targetRoot, 'template.json');
    const template = templateSchema.parse(JSON.parse(fs.readFileSync(templateJsonPath, 'utf-8')));
    const nextTemplate = {
      ...template,
      id: options.id,
      name: options.name,
      description: options.description || template.description,
    };
    fs.writeFileSync(templateJsonPath, JSON.stringify(nextTemplate, null, 2), 'utf-8');

    const industryPath = path.join(targetRoot, 'industry.yaml');
    if (fs.existsSync(industryPath)) {
      const industry = toIndustryTemplate(this.readYamlFile(industryPath));
      this.writeTemplateYaml(options.id, 'industry', 'industry', {
        ...industry,
        id: options.id,
        name: options.name,
        description: options.description || industry.description,
        version: '1.0.0',
      });
    }

    return {
      id: options.id,
      name: options.name,
      description: options.description || template.description,
      employeeCount: template.employees.length,
      version: '1.0.0',
    };
  }

  publishVersion(templateId: string, label: string): TemplateVersion {
    if (!this.safeSegment(templateId)) throw new Error('Invalid template path');
    const root = this.templateRoot(templateId);
    if (!fs.existsSync(root)) throw new Error(`Template not found: ${templateId}`);
    const createdAt = new Date().toISOString();
    const id = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
    const versionsRoot = path.join(root, 'versions');
    const target = path.join(versionsRoot, id);
    fs.mkdirSync(target, { recursive: true });
    for (const name of ['industry.yaml', 'template.json']) {
      const source = path.join(root, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
    }
    for (const name of ['roles', 'workflows', 'contracts', 'employees']) {
      const source = path.join(root, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(target, name), { recursive: true });
    }
    const meta: TemplateVersion = { id, label: label || id, createdAt, path: path.relative(root, target) };
    fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify(meta, null, 2), 'utf-8');
    return meta;
  }

  renderRolePrompt(
    role: RoleTemplate,
    workflows: Record<string, WorkflowTemplate>,
    contracts: Record<string, ContractTemplate>,
  ): string {
    const roleWorkflows = Object.values(workflows).filter((workflow) => workflow.role === role.role);
    const handoffContracts = role.handoffTargets
      .map((target) => target.contract ? contracts[target.contract] : undefined)
      .filter((contract): contract is ContractTemplate => Boolean(contract));

    return [
      `你是${role.displayName || role.role || '数字员工'}。`,
      '## 身份与职责',
      role.prompt.identity.trim(),
      this.renderList(role.prompt.responsibilities),
      '## 业务边界',
      this.renderList(role.prompt.boundaries),
      '## 需要的工具能力',
      this.renderList(role.requiredCapabilities),
      '## 标准工作流',
      roleWorkflows.length
        ? roleWorkflows.map((workflow) => [
          `### ${workflow.name || workflow.id}`,
          workflow.description,
          '步骤：',
          this.renderList(workflow.steps),
          `缺失信息策略：${workflow.missingInfoPolicy}`,
        ].join('\n')).join('\n\n')
        : '无',
      '## 协作与交接',
      role.handoffTargets.length
        ? role.handoffTargets.map((target) => `- 交接给 ${target.role}: ${target.when}${target.contract ? `（契约：${target.contract}）` : ''}`).join('\n')
        : '无',
      ...handoffContracts.map((contract) => [
        `### ${contract.id}`,
        contract.description,
        '必填字段：',
        this.renderFields(contract.requiredFields),
        '可选字段：',
        this.renderFields(contract.optionalFields),
      ].join('\n')),
      '## 输出要求',
      '回答要简洁、结构化。涉及关键业务字段时，区分已确认信息和待确认信息；不要编造缺失字段。',
    ].filter((section) => section.trim().length > 0).join('\n');
  }

  async instantiate(
    templateId: string,
    tenantName: string,
    corpDir: string,
    options?: InstantiateOptions,
  ): Promise<string[]> {
    const loadResult = this.load(templateId);
    if (!loadResult) {
      throw new Error(`Template not found: ${templateId}`);
    }
    const detail = this.loadDetailed(templateId);

    const { template, employeeYamls } = loadResult;
    const tenantDir = path.join(corpDir, tenantName);

    if (fs.existsSync(tenantDir)) {
      throw new Error(`Tenant already exists: ${tenantName}`);
    }

    const createdFiles: string[] = [];

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, 'processes'), { recursive: true });

    const appJson = {
      displayName: template.name,
      description: template.description,
    };
    const appJsonPath = path.join(tenantDir, 'app.json');
    fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
    createdFiles.push(appJsonPath);

    for (const emp of template.employees) {
      const yamlContent = employeeYamls.get(emp.template);
      if (!yamlContent) continue;

      const parsed = asRecord(parseYaml(yamlContent));
      const roleTemplate = detail?.roles[emp.role];
      const nameMap = options?.nameMap ?? {};
      const displayName = (nameMap[emp.role] ?? asString(parsed.displayName)) || emp.role;

      const employeeName = `${emp.role}-${Date.now()}`;
      parsed.id = employeeName;
      parsed.displayName = displayName;
      if (roleTemplate) {
        parsed.description = roleTemplate.description;
        parsed.systemPrompt = roleTemplate.renderedPrompt ?? this.renderRolePrompt(roleTemplate, detail?.workflows ?? {}, detail?.contracts ?? {});
        parsed.capabilities = [
          roleTemplate.displayName,
          roleTemplate.role,
          ...roleTemplate.prompt.responsibilities,
          ...roleTemplate.requiredCapabilities,
        ];
      }

      const outputYaml = stringifyYaml(parsed);
      const outputPath = path.join(tenantDir, 'employees', `${employeeName}.yaml`);
      fs.writeFileSync(outputPath, outputYaml);
      createdFiles.push(outputPath);
    }

    logger.info({ tenantName, templateId, fileCount: createdFiles.length }, 'Tenant instantiated from template');
    return createdFiles;
  }

  private templateRoot(templateId: string): string {
    if (!this.safeSegment(templateId)) throw new Error(`Invalid template id: ${templateId}`);
    return path.join(this.templatesDir, 'industries', templateId);
  }

  private safeSegment(value: string): boolean {
    return /^[a-z0-9][a-z0-9-]*$/.test(value);
  }

  private readYamlFile(file: string): unknown | undefined {
    if (!fs.existsSync(file)) return undefined;
    return parseYaml(fs.readFileSync(file, 'utf-8'));
  }

  private readYamlDir<T>(root: string, dirName: Exclude<TemplateKind, 'industry'>, convert: (value: unknown) => T): Record<string, T> {
    const dir = path.join(root, dirName);
    const result: Record<string, T> = {};
    if (!fs.existsSync(dir)) return result;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
      const key = path.basename(entry.name, '.yaml');
      result[key] = convert(this.readYamlFile(path.join(dir, entry.name)));
    }
    return result;
  }

  private writeTemplateYaml(templateId: string, kind: TemplateKind, id: string, value: unknown): void {
    if (!this.safeSegment(templateId) || !this.safeSegment(id)) throw new Error('Invalid template path');
    const root = this.templateRoot(templateId);
    const target = kind === 'industry'
      ? path.resolve(root, 'industry.yaml')
      : path.resolve(root, kind, `${id}.yaml`);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Template path escapes template root');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stringifyYaml(value), 'utf-8');
  }

  private listVersions(templateId: string): TemplateVersion[] {
    const versionsRoot = path.join(this.templateRoot(templateId), 'versions');
    if (!fs.existsSync(versionsRoot)) return [];
    return fs.readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const metaPath = path.join(versionsRoot, entry.name, 'version.json');
        if (!fs.existsSync(metaPath)) {
          return {
            id: entry.name,
            label: entry.name,
            createdAt: '',
            path: path.relative(this.templateRoot(templateId), path.join(versionsRoot, entry.name)),
          };
        }
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TemplateVersion;
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  private renderFields(fields: Record<string, string>): string {
    const entries = Object.entries(fields);
    if (!entries.length) return '无';
    return entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
  }

  private renderList(items: string[]): string {
    return items.length ? items.map((item) => `- ${item}`).join('\n') : '无';
  }
}
