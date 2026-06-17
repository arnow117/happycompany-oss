import type { LoadedEmployee } from './employee-loader.js';
import type { ClaudeAgent, AgentOptions } from '../agent.js';
import type { AgentProtocol, ToolUseEvent } from './types.js';
import { AgentResponse } from './types.js';
import { claimsCompletedHandoff, extractHandoffRequest, extractHandoffFromToolUse, type HandoffRequest } from './handoff.js';
import { SkillBridge, type CallerContext } from './skill-bridge.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { EnterprisePeopleStore, type EnterpriseRoleBinding } from '../enterprise-people.js';
import { keywordMatch } from './director-router.js';
import type { SkillRunner } from './skill-runner.js';

export interface RegisteredEmployee {
  readonly app: LoadedEmployee;
  readonly agent: ClaudeAgent;
  readonly protocol: AgentProtocol;
}

export interface EmployeeManagerDeps {
  globalModel?: string;
  globalBaseUrl?: string;
  globalAuthToken?: string;
  createAgent: (opts: AgentOptions) => ClaudeAgent;
  skillBridge: SkillBridge;
  corpDir: string;
  dataDir: string;
  skillRunner?: SkillRunner;
}

class AgentAdapter implements AgentProtocol {
  constructor(
    private readonly agent: ClaudeAgent,
    private readonly app: LoadedEmployee,
    private readonly skillBridge: SkillBridge,
    private readonly skillRunner?: SkillRunner,
  ) {}

  get name(): string {
    return this.app.id;
  }

  async execute(
    inputText: string,
    context?: Record<string, unknown>,
    onToolUse?: (event: ToolUseEvent) => void,
  ): Promise<AgentResponse> {
    const chatId = (context?.chatId as string) ?? '__orchestrator__';
    // SDK tool names are colon-free (med_crm.search_bids); restore the
    // namespaced form (med_crm:search_bids) so trace/observability matches the
    // tool ids used elsewhere.
    const denamespace = (n: string): string => (n.includes('.') ? n.replace('.', ':') : n);
    // Employees call tenant tools through the `run_skill` wrapper; surface the
    // real skill:command (e.g. med_crm:search_bids) it invokes instead of the
    // opaque wrapper name, so the trace shows the actual business tool.
    const toolDisplayName = (name: string, input?: Record<string, unknown>): string => {
      if (name.endsWith('run_skill') && input) {
        const skill = input.skill;
        const command = input.command;
        if (typeof skill === 'string' && typeof command === 'string') return `${skill}:${command}`;
      }
      return denamespace(name);
    };
    const employeeMcp = this.skillRunner
      ? this.skillRunner.buildEmployeeMcpServer(this.app)
      : this.skillBridge.buildMcpServer(
        this.app,
        this.app.tenantName,
        { agentId: this.app.id, role: this.app.role },
      );

    const runOnce = async (prompt: string): Promise<{ text: string; handoff: HandoffRequest | null }> => {
      let handoffFromTool: HandoffRequest | null = null;
      const text = await this.agent.respond(prompt, chatId, {
        tools: [],
        mcpServers: { 'employee-platform': employeeMcp },
        skills: this.app.skills,
        onToolStart: (info) => {
          if (info.toolName === 'handoff' && info.toolInput) {
            // Construct a mock message for extractHandoffFromToolUse
            const mockMsg = {
              type: 'tool_use',
              tool_use: {
                name: 'handoff',
                input: info.toolInput,
              },
            };
            handoffFromTool = extractHandoffFromToolUse(mockMsg);
          } else {
            onToolUse?.({ phase: 'start', toolName: toolDisplayName(info.toolName, info.toolInput), toolUseId: info.toolUseId });
          }
        },
        onToolEnd: (info) => {
          if (info.toolName === 'handoff') return;
          onToolUse?.({ phase: 'end', toolName: denamespace(info.toolName), toolUseId: info.toolUseId, elapsedMs: info.elapsedMs });
        },
      });

      return { text, handoff: handoffFromTool ?? extractHandoffRequest(text) };
    };

    const first = await runOnce(this.buildRuntimePrompt(inputText));
    if (first.handoff) {
      return new AgentResponse(first.text, first.handoff, false, {});
    }

    if (claimsCompletedHandoff(first.text)) {
      const retry = await runOnce(this.buildFakeHandoffCorrectionPrompt(inputText, first.text));
      if (retry.handoff) {
        return new AgentResponse(retry.text, retry.handoff, false, { fakeHandoffCorrected: true });
      }

      return new AgentResponse(this.buildBlockedFakeHandoffText(first.text), null, true, { fakeHandoffBlocked: true });
    }

    return new AgentResponse(first.text, null, true, {});
  }

  private buildRuntimePrompt(inputText: string): string {
    const commands = this.skillRunner?.listAvailableCommands(this.app) ?? [];
    const commandLines = commands.length > 0
      ? commands.map((cmd) => `- ${cmd.skillName}.${cmd.name}: ${cmd.description}`).join('\n')
      : '- 暂无已授权业务命令';
    const handoffTargets = this.app.allowedTargets.length > 0
      ? this.app.allowedTargets.map((target) => `- ${target}`).join('\n')
      : '- 无';

    return [
      `你是 ${this.app.displayName} (${this.app.id})。`,
      this.app.description ? `职责: ${this.app.description}` : '',
      '\n长期员工说明已通过 workspace/CLAUDE.md 作为 system prompt 注入。',
      `\n已绑定 skills: ${this.app.skills.length ? this.app.skills.join(', ') : '无'}`,
      `\n已授权业务命令:\n${commandLines}`,
      '\n工具规则:',
      '- 处理租户业务数据时只能调用 run_skill。',
      '- run_skill 的 skill 使用下划线技能名，例如 med_crm。',
      '- run_skill 的 command 使用命令名，例如 global_search、search_hospitals、search_bids、list_maintenance、hospital_info。',
      '- argsJson 必须是 JSON object string，例如 {"keyword":"浙一"}。',
      '- 不要尝试使用 Bash、读取文件或探测运行环境。',
      '\n协同规则:',
      `- 当前员工 ID: ${this.app.id}`,
      `- 可交接目标员工 ID:\n${handoffTargets}`,
      '- 先完成自己职责和已授权工具能处理的查询、判断或记录，再考虑 handoff。',
      '- 不要把自己已授权可查的数据转交给其他员工代查；如果缺少客户、设备、合同等必要线索，直接向用户追问。',
      '- 只有当自己的阶段已经完成，且下一步明确属于其他员工职责时，才调用 handoff，并在 task/context 中携带已查到的事实。',
      '- 只有真实调用 handoff tool 才算完成交接；禁止只用自然语言声称“已转交”“已 handoff”。',
      '- handoff 的 target 必须使用上方可交接目标员工 ID，不要翻译或编造 ID。',
      '\n用户消息:',
      inputText,
    ].filter(Boolean).join('\n');
  }

  private buildFakeHandoffCorrectionPrompt(inputText: string, previousText: string): string {
    return [
      this.buildRuntimePrompt(inputText),
      '\n系统校验:',
      '你上一轮回复声称已经完成 handoff/转交，但平台没有检测到 handoff tool 调用。',
      '现在必须二选一:',
      '1. 如果确实需要交接，立即调用 handoff tool。target 必须来自可交接目标员工 ID，task/context 必须携带已完成工作的事实。',
      '2. 如果不需要或不能交接，明确说明“尚未真实转交”，并给出下一步需要的信息。',
      '不要再次只用自然语言声称已经转交。',
      '\n上一轮回复:',
      previousText,
    ].join('\n');
  }

  private buildBlockedFakeHandoffText(previousText: string): string {
    return [
      '系统检测到上一轮回复声称已经转交，但平台没有收到真实的 handoff 工具调用。',
      '',
      '为避免假交接，我不会把这次标记为已转交。请重新说明要交接给哪位数字员工，或提供必要上下文后我再发起真实 handoff。',
      '',
      '上一轮未生效回复:',
      previousText,
    ].join('\n');
  }
}

export class EmployeeManager {
  private employees = new Map<string, RegisteredEmployee>();

  constructor(private readonly deps: EmployeeManagerDeps) {}

  private keyFor(tenantName: string, appId: string): string {
    return `${tenantName}:${appId}`;
  }

  private resolveKey(appId: string, tenantName?: string): string | undefined {
    if (tenantName) {
      const scoped = this.keyFor(tenantName, appId);
      return this.employees.has(scoped) ? scoped : undefined;
    }
    if (this.employees.has(appId)) return appId;
    for (const [key, employee] of this.employees) {
      if (employee.app.id === appId) return key;
    }
    return undefined;
  }

  register(app: LoadedEmployee): RegisteredEmployee {
    const agentOpts: AgentOptions = {
      name: app.id,
      agentDir: this.resolveWorkspace(app),
      cwd: this.resolveCwd(app),
      model: this.deps.globalModel || app.model,
      baseUrl: this.deps.globalBaseUrl,
      authToken: this.deps.globalAuthToken,
    };

    const agent = this.deps.createAgent(agentOpts);
    const protocol = new AgentAdapter(agent, app, this.deps.skillBridge, this.deps.skillRunner);

    const employee: RegisteredEmployee = { app, agent, protocol };
    this.employees.set(this.keyFor(app.tenantName, app.id), employee);
    return employee;
  }

  registerAll(apps: LoadedEmployee[]): RegisteredEmployee[] {
    return apps.map((app) => this.register(app));
  }

  remove(appId: string, tenantName?: string): boolean {
    const key = this.resolveKey(appId, tenantName);
    return key ? this.employees.delete(key) : false;
  }

  get(appId: string, tenantName?: string): RegisteredEmployee | undefined {
    const key = this.resolveKey(appId, tenantName);
    return key ? this.employees.get(key) : undefined;
  }

  findByRole(role: string): RegisteredEmployee | undefined {
    for (const emp of this.employees.values()) {
      if (emp.app.role === role) return emp;
    }
    return undefined;
  }

  getAppIds(): string[] {
    return Array.from(this.employees.values()).map((employee) => employee.app.id);
  }

  getEmployees(): RegisteredEmployee[] {
    return Array.from(this.employees.values());
  }

  findByHumanUserId(tenantName: string, userId: string, prompt?: string): string | null {
    for (const employee of this.employees.values()) {
      if (
        employee.app.tenantName === tenantName &&
        employee.app.humanUserId === userId
      ) {
        return employee.app.id;
      }
    }

    const person = new EnterprisePeopleStore(this.deps.corpDir)
      .list(tenantName)
      .find((item) => item.userId === userId && item.status === 'active');
    const routedRoleBinding = this.routeRoleBinding(tenantName, person?.roleBindings, prompt);
    if (routedRoleBinding) {
      return routedRoleBinding;
    }
    if (person?.entryEmployee && this.has(person.entryEmployee, tenantName)) {
      return person.entryEmployee;
    }

    return null;
  }

  private routeRoleBinding(
    tenantName: string,
    bindings: EnterpriseRoleBinding[] | undefined,
    prompt: string | undefined,
  ): string | null {
    const candidates = (bindings ?? [])
      .filter((binding) => this.has(binding.assistantId, tenantName))
      .map((binding) => this.get(binding.assistantId, tenantName))
      .filter((employee): employee is RegisteredEmployee => Boolean(employee))
      .filter((employee) => employee.app.tenantName === tenantName);

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!.app.id;
    if (!prompt) return null;

    const routed = keywordMatch(
      prompt,
      candidates.map((employee) => ({
        id: employee.app.id,
        role: employee.app.role,
        capabilities: employee.app.capabilities || [],
        description: employee.app.description,
      })),
      0.3,
    );
    return routed?.agentId ?? null;
  }

  getAgent(appId: string, tenantName?: string): ClaudeAgent | undefined {
    return this.get(appId, tenantName)?.agent;
  }

  getAppMcpServer(
    appId: string,
    callerContext: CallerContext,
  ): McpSdkServerConfigWithInstance | undefined {
    const emp = this.get(appId);
    if (!emp) return undefined;

    return this.deps.skillBridge.buildMcpServer(
      emp.app,
      emp.app.tenantName,
      callerContext,
    );
  }

  has(appId: string, tenantName?: string): boolean {
    return Boolean(this.resolveKey(appId, tenantName));
  }

  getProtocols(): AgentProtocol[] {
    return Array.from(this.employees.values()).map((e) => e.protocol);
  }

  private resolveWorkspace(app: LoadedEmployee): string {
    if (app.workspace) {
      return `${this.deps.corpDir}/${app.tenantName}/${app.workspace}`;
    }
    return `${this.deps.corpDir}/${app.tenantName}/agents/${app.id}`;
  }

  private resolveCwd(app: LoadedEmployee): string {
    return this.resolveWorkspace(app);
  }
}
