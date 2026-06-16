import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { employeeDefinitionSchema, type EmployeeDefinition } from './employee-schema.js';
import { SkillFactory } from './skill-factory.js';
import { buildPrompt, PROMPT_IDS } from '../prompts/index.js';
import type { GenerationResult, OptimizationResult, FeishuQASkill, FormFallback } from './types.js';
import { employeeWorkdirPath } from './employee-org.js';

export interface EmployeeGeneratorDeps {
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  anthropicAuthToken?: string;
  corpDir: string;
  skillFactory: SkillFactory;
}

// ── YAML extraction and repair ──────────────────────────────────────

function extractYaml(text: string): string {
  // Strategy 1: Extract from ```yaml code block
  const blockMatch = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
  if (blockMatch) return blockMatch[1].trim();

  // Strategy 2: Find YAML document start
  const docStart = text.indexOf('id:');
  if (docStart === -1) throw new Error('No YAML content found in response');

  // Find where the YAML block ends (next non-indented non-YAML line)
  const lines = text.slice(docStart).split('\n');
  const yamlLines: string[] = [];
  for (const line of lines) {
    if (yamlLines.length > 0 && /^[A-Za-z]/.test(line) && !line.includes(':')) break;
    yamlLines.push(line);
  }

  return yamlLines.join('\n').trim();
}

function repairYaml(raw: string): string {
  let fixed = raw;

  // Fix: trailing whitespace in multiline strings
  fixed = fixed.replace(/[ \t]+$/gm, '');

  // Fix: unquoted strings that look like numbers

  // Fix: missing quotes around display names with special chars
  fixed = fixed.replace(/^displayName:\s*#/m, 'displayName: "未命名"');

  return fixed;
}

// ── Employee Generator ──────────────────────────────────────────

export class EmployeeGenerator {
  constructor(private readonly deps: EmployeeGeneratorDeps) {}

  /** Layer 1: Call Claude to generate YAML from NL description. */
  private async generateYaml(
    description: string,
    tenantTools: string,
    tenantSkills: string,
  ): Promise<string> {
    const prompt = buildPrompt(PROMPT_IDS.AGENT_GENERATION, {
      description,
      tenantTools,
      tenantSkills,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const baseUrl = this.deps.anthropicBaseUrl || 'https://api.anthropic.com';
      const resp = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.deps.anthropicApiKey,
          ...(this.deps.anthropicAuthToken
            ? { 'anthropic-auth-token': this.deps.anthropicAuthToken }
            : {}),
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          temperature: 0.3,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Claude API error ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = (await resp.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const textContent = data.content.find((c) => c.type === 'text');
      if (!textContent?.text) throw new Error('No text in Claude response');

      return textContent.text;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extract YAML from Claude output → repair → parse → Zod validate.
   * Returns the validated EmployeeDefinition.
   */
  private parseAndValidate(rawText: string): { def: EmployeeDefinition; rawYaml: string; warnings: string[] } {
    const warnings: string[] = [];

    let yamlStr: string;
    try {
      yamlStr = extractYaml(rawText);
    } catch {
      throw new Error('Failed to extract YAML from Claude response. Raw output:\n' + rawText.slice(0, 500));
    }

    const repaired = repairYaml(yamlStr);

    let parsed: unknown;
    try {
      parsed = parseYaml(repaired);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`YAML parse error: ${msg}\n\nRaw YAML:\n${repaired.slice(0, 500)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML did not produce an object');
    }

    const result = employeeDefinitionSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Schema validation failed:\n${issues}`);
    }

    return { def: result.data, rawYaml: repaired, warnings };
  }

  /**
   * Reference validation — check tools, skills, roles exist.
   * Returns warnings for missing items (triggers fallback).
   */
  private validateReferences(
    def: EmployeeDefinition,
    _tenantTools: string[],
    _tenantSkills: string[],
  ): { warnings: string[]; missingTools: string[] } {
    const warnings: string[] = [];
    const missingTools: string[] = [];

    if (def.tools.length === 0 && def.skills.length === 0) {
      warnings.push('Agent has no tools or skills assigned');
    }

    return { warnings, missingTools };
  }

  /**
   * Write YAML to tenant employees directory.
   */
  private writeDraft(def: EmployeeDefinition, tenant: string): string {
    const employeesDir = path.join(this.deps.corpDir, tenant, 'employees');
    fs.mkdirSync(employeesDir, { recursive: true });

    const filePath = path.join(employeesDir, `${def.id}.yaml`);
    const yaml = stringifyYaml({
      id: def.id,
      displayName: def.displayName,
      description: def.description,
      model: def.model || 'claude-sonnet-4-6',
      systemPrompt: def.systemPrompt,
      maxTurns: def.maxTurns,
      tools: def.tools,
      skills: def.skills,
      workspace: def.workspace || `agents/${def.id}`,
      role: def.role,
      ...(def.humanUserId ? { humanUserId: def.humanUserId } : {}),
      allowedTargets: def.allowedTargets,
      capabilities: def.capabilities,
      ...(def.schedule ? { schedule: def.schedule } : {}),
    });

    fs.writeFileSync(filePath, yaml, 'utf-8');
    return filePath;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Full pipeline: NL description → validated EmployeeDefinition → draft YAML.
   */
  async generate(
    description: string,
    tenant: string,
    tenantTools: string,
    tenantSkills: string,
  ): Promise<GenerationResult> {
    const toolsList = tenantTools.split('\n').filter(Boolean);
    const skillsList = tenantSkills.split('\n').filter(Boolean);

    const rawText = await this.generateYaml(description, tenantTools, tenantSkills);

    const { def, rawYaml, warnings } = this.parseAndValidate(rawText);

    const refCheck = this.validateReferences(def, toolsList, skillsList);
    warnings.push(...refCheck.warnings);

    const workspace = def.workspace || path.relative(
      path.join(this.deps.corpDir, tenant),
      employeeWorkdirPath(this.deps.corpDir, tenant, def.id),
    );
    const normalizedDef = { ...def, workspace };
    const filePath = this.writeDraft(normalizedDef, tenant);

    let fallbackLevel1: FeishuQASkill | undefined;
    let fallbackLevel2: FormFallback | undefined;

    if (refCheck.missingTools.length > 0) {
      const skill = this.deps.skillFactory.generateFeishuQASkill(tenant, {
        agentId: def.id,
        chatId: 'finance-team',
        topic: refCheck.missingTools[0],
      });
      fallbackLevel1 = {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        chatId: 'finance-team',
        prompt: `Send feishu message to ask about: ${refCheck.missingTools.join(', ')}`,
      };
    }

    const agent = {
      id: def.id,
      displayName: def.displayName,
      description: def.description,
      model: def.model || 'claude-sonnet-4-6',
      systemPrompt: def.systemPrompt,
      tools: def.tools,
      skills: def.skills,
      role: def.role,
      capabilities: def.capabilities,
      workspace,
      source: 'generated' as const,
      createdAt: Date.now(),
      hasFallbackLevel1: !!fallbackLevel1,
      hasFallbackLevel2: !!fallbackLevel2,
      toolCount: def.tools.length,
      skillCount: def.skills.length,
    };

    return { agent, warnings, rawYaml, fallbackLevel1, fallbackLevel2 };
  }

  /** Analyze multiple agents and produce an optimized merged agent. */
  async optimize(
    agents: Array<{
      id: string;
      displayName: string;
      role: string;
      systemPrompt: string;
      tools: string[];
      skills: string[];
    }>,
    goal: string,
  ): Promise<OptimizationResult> {
    const agentSummaries = agents
      .map(
        (a) =>
          `## ${a.displayName} (${a.role})\n${a.systemPrompt.slice(0, 500)}\nTools: ${a.tools.join(', ')}\nSkills: ${a.skills.join(', ')}`,
      )
      .join('\n\n');

    const prompt = buildPrompt(PROMPT_IDS.AGENT_OPTIMIZE, {
      goal,
      agentSummaries,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const baseUrl = this.deps.anthropicBaseUrl || 'https://api.anthropic.com';
      const resp = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.deps.anthropicApiKey,
          ...(this.deps.anthropicAuthToken
            ? { 'anthropic-auth-token': this.deps.anthropicAuthToken }
            : {}),
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          temperature: 0.3,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`Claude API error ${resp.status}`);

      const data = (await resp.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const textContent = data.content.find((c) => c.type === 'text');
      if (!textContent?.text) throw new Error('No text in response');

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in optimize response');

      const result = JSON.parse(jsonMatch[0]) as {
        displayName: string;
        systemPrompt: string;
        tools: string[];
        skills: string[];
        rationale: string;
      };

      return {
        id: `optimized-${Date.now()}`,
        displayName: result.displayName,
        systemPrompt: result.systemPrompt,
        tools: result.tools,
        skills: result.skills,
        rationale: result.rationale,
        originalAgentIds: agents.map((a) => a.id),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Fork: copy agent config to new instance. */
  async fork(
    sourceAgent: {
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
      hasFallbackLevel1: boolean;
      hasFallbackLevel2: boolean;
    },
    personName: string,
    personRole: string,
    tenant: string,
  ): Promise<GenerationResult['agent']> {
    const id = `${sourceAgent.id}-fork-${Date.now()}`;

    const def: EmployeeDefinition = {
      id,
      displayName: personName,
      description: `Fork of ${sourceAgent.displayName} — ${personRole}`,
      model: sourceAgent.model,
      systemPrompt: sourceAgent.systemPrompt,
      maxTurns: 50,
      tools: [...sourceAgent.tools],
      skills: [...sourceAgent.skills],
      workspace: `agents/${id}`,
      role: personRole || sourceAgent.role,
      allowedTargets: [],
      capabilities: [...sourceAgent.capabilities],
      source: 'forked',
      createdAt: Date.now(),
    };

    this.writeDraft(def, tenant);

    return {
      id,
      displayName: personName,
      description: def.description,
      model: def.model,
      systemPrompt: def.systemPrompt,
      tools: def.tools,
      skills: def.skills,
      role: def.role,
      capabilities: def.capabilities,
      workspace: def.workspace,
      source: 'forked',
      createdAt: Date.now(),
      hasFallbackLevel1: sourceAgent.hasFallbackLevel1,
      hasFallbackLevel2: sourceAgent.hasFallbackLevel2,
      toolCount: def.tools.length,
      skillCount: def.skills.length,
    };
  }

  /** Pre-populate agents from seed YAML files in employees/ dir. */
  async seedEmployees(tenant: string): Promise<GenerationResult['agent'][]> {
    const employeesDir = path.join(this.deps.corpDir, tenant, 'employees');
    if (!fs.existsSync(employeesDir)) {
      return [];
    }
    return this.seedFromDir(employeesDir);
  }

  private seedFromDir(dir: string): GenerationResult['agent'][] {
    const seedIds = ['sales-zhangsan', 'maintenance-lisi', 'finance-wangwu'];
    const agents: GenerationResult['agent'][] = [];

    for (const id of seedIds) {
      const yamlPath = path.join(dir, `${id}.yaml`);
      if (!fs.existsSync(yamlPath)) continue;

      const raw = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const def = employeeDefinitionSchema.parse(parsed);

      agents.push({
        id: def.id,
        displayName: def.displayName,
        description: def.description,
        model: def.model || 'claude-sonnet-4-6',
        systemPrompt: def.systemPrompt,
        tools: def.tools,
        skills: def.skills,
        role: def.role,
        capabilities: def.capabilities,
        workspace: def.workspace,
        source: 'prepopulated',
        createdAt: Date.now(),
        hasFallbackLevel1: false,
        hasFallbackLevel2: false,
        toolCount: def.tools.length,
        skillCount: def.skills.length,
      });
    }

    return agents;
  }

  /** Summarize available tools for a tenant from the corp directory. */
  summarizeTools(tenant: string): string {
    const corpTenantDir = path.join(this.deps.corpDir, tenant);
    if (!fs.existsSync(corpTenantDir)) return '(no tools available)';

    const lines: string[] = [];
    const skillsDir = path.join(corpTenantDir, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) return '(no tools available)';

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      if (!entry.isDirectory()) continue;
      const toolsPath = path.join(skillsDir, entry.name, 'tools.json');
      if (!fs.existsSync(toolsPath)) continue;

      try {
        const toolsJson = JSON.parse(fs.readFileSync(toolsPath, 'utf-8')) as {
          name: string;
          tools?: Array<{ name: string; description: string }>;
        };
        const skillName = toolsJson.name || entry.name;
        const toolDefs = toolsJson.tools || [];
        for (const t of toolDefs) {
          lines.push(`  - ${skillName}:${t.name} — ${t.description}`);
        }
      } catch {
        // skip unparseable tools.json
      }
    }

    return lines.length > 0 ? lines.join('\n') : '(no tools available)';
  }

  /** Summarize available skills for a tenant. */
  summarizeSkills(tenant: string): string {
    const skills = this.deps.skillFactory.listTenantSkills(tenant);
    if (skills.length === 0) {
      const skillDir = path.join(this.deps.corpDir, tenant, '.claude', 'skills');
      if (fs.existsSync(skillDir)) {
        const entries = fs.readdirSync(skillDir, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => `  - ${e.name}`)
          .join('\n');
      }
      return '(no skills available)';
    }

    return skills.map((s) => `  - ${s.name} — ${s.description}`).join('\n');
  }
}
