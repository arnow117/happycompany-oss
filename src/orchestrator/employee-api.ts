import type { Hono } from 'hono';
import type { EmployeeManager } from './employee-colony.js';
import type { LoadedEmployee } from './employee-loader.js';
import type { EmployeeDefinition } from './employee-schema.js';
import type { SkillFactory } from './skill-factory.js';
import { TraceStore } from './trace-store.js';
import type { EmployeeGenerator } from './employee-generator.js';
import type { GenerationResult, OptimizationResult, AgentGraph } from './types.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from '../workdir-scanner.js';
import { employeeWorkdirPath } from './employee-org.js';

export interface EmployeeApiDeps {
  generator: EmployeeGenerator;
  skillFactory: SkillFactory;
  employeeManager?: EmployeeManager;
  traceStore?: TraceStore;
  corpDir: string;
  tenant: string;
}

interface WorkdirEmployeeDraft {
  id?: string;
  displayName: string;
  role: string;
  description?: string;
  skillNames: string[];
}

export function registerEmployeeRoutes(app: Hono, deps: EmployeeApiDeps): void {
  const employees = new Map<string, GenerationResult['agent']>();

  /** Get employee list from colony (source of truth) + memory fallback. */
  function getEmployeeList(): GenerationResult['agent'][] {
    const list: GenerationResult['agent'][] = [];
    const seen = new Set<string>();

    if (deps.employeeManager) {
      for (const ca of deps.employeeManager.getEmployees()) {
        const appId = ca.app.id;
        seen.add(appId);
        list.push({
          id: appId,
          displayName: ca.app.displayName || appId,
          description: ca.app.description || '',
          model: ca.app.model || 'claude-sonnet-4-6',
          systemPrompt: ca.app.systemPrompt || '',
          tools: ca.app.tools || [],
          skills: ca.app.skills || [],
          role: ca.app.role || '',
          capabilities: ca.app.capabilities || [],
          workspace: ca.app.workspace || '',
          source: 'prepopulated',
          createdAt: Date.now(),
          hasFallbackLevel1: false,
          hasFallbackLevel2: false,
          toolCount: (ca.app.tools || []).length,
          skillCount: (ca.app.skills || []).length,
          tenantName: ca.app.tenantName,
        });
      }
    }

    // Also include memory-only employees
    for (const [id, emp] of employees) {
      if (!seen.has(id)) list.push(emp);
    }

    return list;
  }

  /** Register an employee YAML file with EmployeeManager. */
  function registerWithColony(agentId: string, tenant = deps.tenant): boolean {
    if (!deps.employeeManager) return false;

    if (deps.employeeManager.has(agentId, tenant)) {
      return true;
    }

    const employeesDir = path.join(deps.corpDir, tenant, 'employees');
    const yamlPath = path.join(employeesDir, `${agentId}.yaml`);

    if (!fs.existsSync(yamlPath)) return false;

    try {
      const raw = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const def = parsed as EmployeeDefinition;
      const role = def.role || 'member';
      const workspace = def.workspace || `agents/${agentId}`;
      const workdir = workspace.startsWith('/')
        ? workspace
        : path.join(deps.corpDir, tenant, workspace);
      fs.mkdirSync(workdir, { recursive: true });

      const loadedEmployee: LoadedEmployee = {
        ...def,
        id: def.id || agentId,
        displayName: def.displayName || agentId,
        description: def.description || '',
        model: def.model || 'claude-sonnet-4-6',
        systemPrompt: def.systemPrompt || '',
        maxTurns: def.maxTurns ?? 50,
        tools: def.tools ?? [],
        skills: def.skills ?? [],
        workspace,
        role,
        allowedTargets: def.allowedTargets ?? [],
        capabilities: def.capabilities ?? [],
        tenantName: tenant,
        filePath: yamlPath,
        loadedAtMs: Date.now(),
      };

      deps.employeeManager.register(loadedEmployee);
      return true;
    } catch {
      return false;
    }
  }

  function importYamlFiles(sourceTenantDir: string, targetTenant: string): { imported: string[]; skipped: string[] } {
    const imported: string[] = [];
    const skipped: string[] = [];
    const sourceDir = path.join(sourceTenantDir, 'employees');
    const targetDir = path.join(deps.corpDir, targetTenant, 'employees');
    fs.mkdirSync(targetDir, { recursive: true });

    if (!fs.existsSync(sourceDir)) return { imported, skipped };
    for (const file of fs.readdirSync(sourceDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const sourcePath = path.join(sourceDir, file);
      if (!fs.statSync(sourcePath).isFile()) continue;

      try {
        const raw = fs.readFileSync(sourcePath, 'utf-8');
        const parsed = parseYaml(raw) as Partial<EmployeeDefinition> | null;
        const id = parsed?.id || path.basename(file, path.extname(file));
        const targetPath = path.join(targetDir, `${id}.yaml`);
        fs.writeFileSync(targetPath, raw, 'utf-8');
        if (registerWithColony(id, targetTenant)) {
          imported.push(id);
        } else {
          skipped.push(id);
        }
      } catch {
        skipped.push(path.basename(file, path.extname(file)));
      }
    }

    return { imported, skipped };
  }

  function sanitizeEmployeeId(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || `employee-${Date.now()}`;
  }

  function ensureTenantScaffold(tenant: string): void {
    const tenantDir = path.join(deps.corpDir, tenant);
    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    if (!fs.existsSync(path.join(tenantDir, 'app.json'))) {
      fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify({
        displayName: tenant,
        description: 'Imported from workdir',
      }, null, 2));
    }
  }

  function importWorkdirEmployees(sourceWorkdir: string, targetTenant: string, drafts: WorkdirEmployeeDraft[]): { imported: string[]; skipped: string[] } {
    const scanner = new WorkdirScanner();
    const scan = scanner.scan(sourceWorkdir);
    const skillByName = new Map(scan.skills.map((skill) => [skill.name, skill]));
    const imported: string[] = [];
    const skipped: string[] = [];
    const targetDir = path.join(deps.corpDir, targetTenant, 'employees');
    ensureTenantScaffold(targetTenant);

    for (const draft of drafts) {
      const selectedSkills = draft.skillNames
        .map((name) => skillByName.get(name))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
      if (selectedSkills.length === 0) {
        skipped.push(draft.displayName);
        continue;
      }

      const id = sanitizeEmployeeId(draft.id || draft.role || draft.displayName);
      const description = draft.description || selectedSkills.map((skill) => skill.description).filter(Boolean).join('\n') || `Imported employee for ${draft.displayName}`;
      const definition: EmployeeDefinition = {
        id,
        displayName: draft.displayName,
        description,
        model: '',
        systemPrompt: [
          `你是${draft.displayName}，负责处理从工作目录导入的能力。`,
          `工作目录: ${sourceWorkdir}`,
          `可用技能: ${selectedSkills.map((skill) => skill.name).join(', ')}`,
          '优先使用已分配技能解决问题；如果请求超出职责范围，说明需要其他数字员工协作。',
        ].join('\n'),
        maxTurns: 50,
        tools: [],
        skills: selectedSkills.map((skill) => skill.name),
        workspace: sourceWorkdir,
        role: draft.role || 'member',
        allowedTargets: [],
        capabilities: selectedSkills.flatMap((skill) => [skill.name, skill.description]).filter((item): item is string => Boolean(item)),
        template: `workdir/${draft.role || 'member'}`,
        oneLiner: selectedSkills.map((skill) => skill.description).find(Boolean) || `使用 ${selectedSkills.length} 个导入技能处理业务任务。`,
        source: 'generated',
        createdAt: Date.now(),
      };

      fs.writeFileSync(path.join(targetDir, `${id}.yaml`), stringifyYaml(definition), 'utf-8');
      if (registerWithColony(id, targetTenant)) {
        imported.push(id);
      } else {
        skipped.push(id);
      }
    }

    return { imported, skipped };
  }

  // ── GET /api/employees — list all employees ──────────
  app.get('/api/employees', (c) => {
    const tenant = c.req.query('tenant');
    const employeeList = getEmployeeList();
    return c.json({
      employees: tenant
        ? employeeList.filter((employee) => employee.tenantName === tenant)
        : employeeList,
    });
  });

  app.get('/api/employees/templates', (c) => {
    return c.json({ templates: [] });
  });

  app.post('/api/employees/import', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sourcePath?: string;
        tenant?: string;
        employeeDrafts?: WorkdirEmployeeDraft[];
      };
      const sourcePath = body.sourcePath?.trim();
      if (!sourcePath) {
        return c.json({ error: 'sourcePath is required' }, 400);
      }
      const sourceTenantDir = path.resolve(sourcePath);
      if (!fs.existsSync(sourceTenantDir) || !fs.statSync(sourceTenantDir).isDirectory()) {
        return c.json({ error: 'sourcePath must be an existing tenant directory' }, 400);
      }
      const hasTenantShape = ['app.json', 'employees', '.claude']
        .some((name) => fs.existsSync(path.join(sourceTenantDir, name)));
      const hasWorkdirSkills = fs.existsSync(path.join(sourceTenantDir, '.claude', 'skills'));
      const drafts = body.employeeDrafts ?? [];
      const hasDrafts = drafts.length > 0;
      if (!hasTenantShape && !(hasDrafts && hasWorkdirSkills)) {
        return c.json({ error: 'sourcePath does not look like a corp tenant directory' }, 400);
      }

      const tenant = body.tenant || deps.tenant;
      if (hasDrafts) {
        const result = importWorkdirEmployees(sourceTenantDir, tenant, drafts);
        return c.json({ ...result, count: result.imported.length });
      }

      const result = importYamlFiles(sourceTenantDir, tenant);
      return c.json({ ...result, count: result.imported.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── POST /api/employees/generate — NL → employee config ────
  app.post('/api/employees/generate', async (c) => {
    try {
      const body = (await c.req.json()) as {
        description?: string;
        tenant?: string;
      };
      if (!body.description || typeof body.description !== 'string') {
        return c.json({ error: 'description is required' }, 400);
      }

      const tenant = body.tenant || deps.tenant;
      const toolsSummary = deps.generator.summarizeTools(tenant);
      const skillsSummary = deps.generator.summarizeSkills(tenant);

      const result: GenerationResult = await deps.generator.generate(
        body.description,
        tenant,
        toolsSummary,
        skillsSummary,
      );

      employees.set(result.agent.id, result.agent);
      registerWithColony(result.agent.id, tenant);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── POST /api/employees/optimize — merge multiple employees ──────
  app.post('/api/employees/optimize', async (c) => {
    try {
      const body = (await c.req.json()) as {
        agentIds?: string[];
        goal?: string;
      };
      if (!body.agentIds?.length || !body.goal) {
        return c.json({ error: 'agentIds and goal are required' }, 400);
      }

      const targetAgents = body.agentIds
        .map((id) => employees.get(id))
        .filter((a): a is GenerationResult['agent'] => !!a);

      if (targetAgents.length < 2) {
        return c.json({ error: 'Need at least 2 valid agents to optimize' }, 400);
      }

      const result: OptimizationResult = await deps.generator.optimize(
        targetAgents,
        body.goal,
      );

      // Register the optimized agent
      employees.set(result.id, {
        id: result.id,
        displayName: result.displayName,
        description: result.rationale,
        model: 'claude-sonnet-4-6',
        systemPrompt: result.systemPrompt,
        tools: result.tools,
        skills: result.skills,
        role: 'specialist',
        capabilities: [],
        workspace: '',
        source: 'generated',
        createdAt: Date.now(),
        hasFallbackLevel1: false,
        hasFallbackLevel2: false,
        toolCount: result.tools.length,
        skillCount: result.skills.length,
      });

      return c.json({ result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── GET /api/employees/graph — node/edge data flow graph ──────
  app.get('/api/employees/graph', (c) => {
    const employeeList = getEmployeeList();
    const graph = buildGraph(employeeList);
    return c.json({ graph });
  });

  // ── POST /api/employees/fork — copy agent to new instance ─────
  app.post('/api/employees/fork', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sourceAgentId?: string;
        personName?: string;
        personRole?: string;
        humanUserId?: string;
        tenant?: string;
      };
      if (!body.sourceAgentId || !body.personName) {
        return c.json(
          { error: 'sourceAgentId and personName are required' },
          400,
        );
      }

      const tenant = body.tenant || deps.tenant;
      const source = getEmployeeList().find((agent) =>
        agent.id === body.sourceAgentId && (!agent.tenantName || agent.tenantName === tenant)
      );
      if (!source) {
        return c.json({ error: `Agent "${body.sourceAgentId}" not found` }, 404);
      }

      const forked = await deps.generator.fork(
        source,
        body.personName,
        body.personRole || source.role,
        tenant,
      );
      const yamlPath = path.join(deps.corpDir, tenant, 'employees', `${forked.id}.yaml`);
      if (body.humanUserId && fs.existsSync(yamlPath)) {
        const raw = parseYaml(fs.readFileSync(yamlPath, 'utf-8')) as EmployeeDefinition;
        fs.writeFileSync(yamlPath, stringifyEmployeeYaml({ ...raw, humanUserId: body.humanUserId }), 'utf-8');
      }
      fs.mkdirSync(employeeWorkdirPath(deps.corpDir, tenant, forked.id), { recursive: true });

      employees.set(forked.id, forked);

      // Register with EmployeeManager for real execution
      const registered = registerWithColony(forked.id, tenant);
      return c.json({ agent: forked, colonyRegistered: registered });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── GET /api/employees/stats — historical stats summary ───────
  app.get('/api/employees/stats', (c) => {
    const employeeList = getEmployeeList();
    const roles: Record<string, number> = {};
    let totalSkills = 0;
    let totalFallbacks = 0;

    for (const a of employeeList) {
      roles[a.role] = (roles[a.role] || 0) + 1;
      totalSkills += a.skillCount;
      if (a.hasFallbackLevel1) totalFallbacks++;
      if (a.hasFallbackLevel2) totalFallbacks++;
    }

    return c.json({
      stats: {
        totalAgents: employeeList.length,
        totalSkills,
        totalFallbacks,
        agentsByRole: roles,
      },
    });
  });

  // ── POST /api/employees/seed — pre-populate employees ───────
  app.post('/api/employees/seed', async (c) => {
    try {
      const body = (await c.req.json()) as { tenant?: string };
      const tenant = body.tenant || deps.tenant;
      const seedAgents = await deps.generator.seedEmployees(tenant);
      for (const a of seedAgents) {
        employees.set(a.id, a);
        registerWithColony(a.id, tenant);
      }
      return c.json({ agents: seedAgents, count: seedAgents.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── GET /api/employees/traces — list orchestration traces ──────
  app.get('/api/employees/traces', (c) => {
    if (!deps.traceStore) return c.json({ traces: [] });
    const traces = deps.traceStore.list();
    return c.json({ traces });
  });

  // ── GET /api/employees/traces/:id — single trace detail ────────
  app.get('/api/employees/traces/:id', (c) => {
    if (!deps.traceStore) return c.json({ error: 'Trace store not available' }, 404);
    const id = c.req.param('id');
    const trace = deps.traceStore.get(id);
    if (!trace) return c.json({ error: 'Trace not found' }, 404);
    return c.json({ trace, graph: TraceStore.toGraph(trace) });
  });

  // ── Graph builder ──────────────────────────────────────────

  function buildGraph(employeeList: GenerationResult['agent'][]): AgentGraph {
    const nodes: AgentGraph['nodes'] = [];
    const edges: AgentGraph['edges'] = [];
    const seenNodes = new Set<string>();

    for (const agent of employeeList) {
      const agentNodeId = `agent:${agent.id}`;
      if (!seenNodes.has(agentNodeId)) {
        seenNodes.add(agentNodeId);
        nodes.push({
          id: agentNodeId,
          label: agent.displayName,
          type: 'agent',
          agentId: agent.id,
        });
      }

      for (const tool of agent.tools) {
        const toolNodeId = `tool:${tool}`;
        if (!seenNodes.has(toolNodeId)) {
          seenNodes.add(toolNodeId);
          nodes.push({ id: toolNodeId, label: tool, type: 'tool' });
        }
        edges.push({
          source: agentNodeId,
          target: toolNodeId,
          type: 'tool-call',
        });
      }

      for (const skill of agent.skills) {
        const skillNodeId = `skill:${skill}`;
        if (!seenNodes.has(skillNodeId)) {
          seenNodes.add(skillNodeId);
          nodes.push({ id: skillNodeId, label: skill, type: 'skill' });
        }
        edges.push({
          source: agentNodeId,
          target: skillNodeId,
          type: 'tool-call',
        });
      }

      if (agent.hasFallbackLevel1) {
        const fbNodeId = `fallback:${agent.id}-l1`;
        nodes.push({ id: fbNodeId, label: '飞书问答', type: 'fallback' });
        edges.push({
          source: agentNodeId,
          target: fbNodeId,
          label: 'L1 fallback',
          type: 'fallback',
        });
      }
      if (agent.hasFallbackLevel2) {
        const fbNodeId = `fallback:${agent.id}-l2`;
        nodes.push({ id: fbNodeId, label: '表单流程', type: 'fallback' });
        edges.push({
          source: agentNodeId,
          target: fbNodeId,
          label: 'L2 fallback',
          type: 'fallback',
        });
      }
    }

    const order = ['sales-zhangsan', 'maintenance-lisi', 'finance-wangwu'];
    for (let i = 0; i < order.length - 1; i++) {
      const srcId = `agent:${order[i]}`;
      const tgtId = `agent:${order[i + 1]}`;
      if (seenNodes.has(srcId) && seenNodes.has(tgtId)) {
        const labels = ['合同', '回执单'];
        edges.push({
          source: srcId,
          target: tgtId,
          label: labels[i] || '数据',
          type: 'data-flow',
        });
      }
    }

    return { nodes, edges };
  }
}

function stringifyEmployeeYaml(def: EmployeeDefinition): string {
  const yamlObj: Record<string, unknown> = {
    id: def.id,
    displayName: def.displayName,
    description: def.description,
    model: def.model || 'claude-sonnet-4-6',
    systemPrompt: def.systemPrompt,
    maxTurns: def.maxTurns ?? 50,
    tools: def.tools ?? [],
    skills: def.skills ?? [],
    workspace: def.workspace || `agents/${def.id}`,
    role: def.role || '',
    ...(def.humanUserId ? { humanUserId: def.humanUserId } : {}),
    allowedTargets: def.allowedTargets ?? [],
    capabilities: def.capabilities ?? [],
    ...(def.schedule ? { schedule: def.schedule } : {}),
  };
  return stringifyYaml(yamlObj);
}
