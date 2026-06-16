import { loadConfig, reloadConfig, diffConfigs, hasPlaintextCredentials, isEnvVarUnset } from './config.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger.js';
import { BotManager } from './bot.js';
import type { RespondOptions } from './bot.js';
import { ClaudeAgent } from './agent.js';
import { MessageStore } from './store.js';
import { MessageBus } from './bus.js';
import { DedupCache } from './dedup.js';
import { startWebServer } from './web.js';
import type { MutableRef } from './web.js';
import { TaskScheduler } from './scheduler.js';
import { FeishuChannel } from './feishu.js';
import { DingTalkChannel } from './dingtalk.js';
import { initWorkdir } from './workdir.js';
import { generateCapabilityDesc, extractBotDescription } from './desc.js';
import { readFileSync, watchFile, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChannelAdapter } from './channel.js';
import type { Config } from './config.js';
import type { BotConfig } from './types.js';
import { MemoryManager } from './memory.js';
import { buildPlatformMcpServer, buildTenantMcpServer } from './mcp-tools.js';
import { buildKnowledgeMcpServer } from './knowledge.js';
import { ToolRegistry } from './tool-registry.js';
import { ConversationArchiver } from './archiver.js';
import { AppServerMgr } from './app-server.js';
import { EmployeeLoader } from './orchestrator/employee-loader.js';
import { SkillBridge } from './orchestrator/skill-bridge.js';
import { SkillRunner } from './orchestrator/skill-runner.js';
import { EmployeeManager } from './orchestrator/employee-colony.js';
import { WriteLockManager } from './orchestrator/write-lock.js';
import { StatsCollector, InMemoryStatsStore } from './orchestrator/stats.js';
import { SkillToolBuilder } from './skill-tool-builder.js';
import { ContractChainTracker, InMemoryChainStore } from './orchestrator/contract-chain.js';
import { ContractStore } from './orchestrator/contract-store.js';
import { EventBridge } from './orchestrator/event-bridge.js';
import { PMOOrchestratorRunner } from './orchestrator/orchestrator-runner.js';
import { TraceStore } from './orchestrator/trace-store.js';
import { resolveEnterpriseEntryAgent } from './enterprise-routing.js';
import Database from 'better-sqlite3';
import { resolveCorpDir } from './corp-dir.js';
import { applyRuntimeProfileDefaults, resolveRuntimeDataDir, resolveRuntimeProfile } from './runtime-config-profile.js';

function runtimeAgentCacheKey(botName: string, agentDir?: string, cwd?: string): string {
  if (!agentDir) return botName;
  return `runtime:${botName}:${resolve(agentDir)}:${resolve(cwd ?? agentDir)}`;
}

/** Enrich config bot entries with the record-key as `name` (BotConfig requires it). */
function botsWithNames(config: Config): Record<string, BotConfig> {
  const result: Record<string, BotConfig> = {};
  for (const [name, bot] of Object.entries(config.bots)) {
    result[name] = { ...bot, name };
  }
  return result;
}

function createNoOpChannel(name: string): ChannelAdapter {
  return {
    name,
    start: async () => {},
    stop: async () => {},
    onMessage: () => () => {},
    onCardAction: () => () => {},
    send: async () => {},
    sendStreaming: () => ({ update() {}, finalize() {}, updateToolStatus() {}, abort() {}, delete() {} }),
    react: async () => {},
    downloadFile: async () => ({ type: 'file', name: '', localPath: '' }),
  };
}

function createChannel(botConfig: BotConfig): ChannelAdapter {
  if (botConfig.channel === 'feishu') {
    return new FeishuChannel(botConfig);
  }
  if (botConfig.channel === 'dingtalk') {
    return new DingTalkChannel(botConfig);
  }
  if (botConfig.channel === 'web') {
    return createNoOpChannel(`web:${botConfig.name}`);
  }
  throw new Error(`Unknown channel type: ${botConfig.channel}`);
}

function hasUnsafePlaintextCredentials(raw: Record<string, unknown>): boolean {
  const bots = raw.bots;
  if (!bots || typeof bots !== 'object' || Array.isArray(bots)) return false;
  for (const bot of Object.values(bots as Record<string, unknown>)) {
    if (!bot || typeof bot !== 'object' || Array.isArray(bot)) continue;
    const credentials = (bot as Record<string, unknown>).credentials;
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) continue;
    for (const value of Object.values(credentials as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      if (value.startsWith('enc:') || isEnvVarUnset(value)) continue;
      return true;
    }
  }
  return false;
}

function normalizeAdminToken(config: Config): void {
  if (config.adminToken && isEnvVarUnset(config.adminToken)) {
    delete config.adminToken;
  }
}

function assertProductionConfigSafe(raw: Record<string, unknown>, config: Config): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!config.adminToken) {
    throw new Error('Production requires adminToken. Set HAPPYCOMPANY_ADMIN_TOKEN or configure adminToken.');
  }
  if (hasUnsafePlaintextCredentials(raw)) {
    throw new Error('Production config contains plaintext bot credentials. Use env vars or encrypted config values.');
  }
}

/** Build a capability description string from all bots' installed skills. */
function buildCapabilityDesc(
  bots: Record<string, BotConfig>,
): string {
  const descs: string[] = [];
  for (const [, botConfig] of Object.entries(bots)) {
    const workdir = botConfig.cwd ?? botConfig.agentDir;

    const parts: string[] = [];

    // Bot-level description from workdir CLAUDE.md
    const botDesc = extractBotDescription(workdir);
    if (botDesc) {
      parts.push(botDesc);
    }

    const skillDesc = generateCapabilityDesc(workdir);
    if (skillDesc) {
      parts.push(skillDesc);
    }

    if (parts.length > 0) {
      descs.push(`**${botConfig.displayName}**: ${parts.join('\n\n')}`);
    }
  }
  if (descs.length === 0) return '';
  return `## Available Bots\n\n${descs.join('\n\n')}`;
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

async function main(): Promise<void> {
  const runtimeProfile = resolveRuntimeProfile();
  const configPath = runtimeProfile.configPath;
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const dataDir = resolveRuntimeDataDir(raw, runtimeProfile);
  const keyPath = `${dataDir}/config/encryption.key`;
  let currentConfig: Config = applyRuntimeProfileDefaults(loadConfig(configPath, keyPath), runtimeProfile);
  normalizeAdminToken(currentConfig);
  assertProductionConfigSafe(raw, currentConfig);
  let currentBots = botsWithNames(currentConfig);
  const configRef: MutableRef<Config> = { current: currentConfig };

  for (const [name, bot] of Object.entries(currentConfig.bots)) {
    if (bot.credentials && hasPlaintextCredentials(bot.credentials)) {
      logger.warn(
        { bot: name },
        'Bot has plaintext credentials — consider encrypting via saveConfig()',
      );
    }
  }

  logger.info(
    {
      bots: Object.keys(currentBots),
      profile: runtimeProfile.name,
      profileSource: runtimeProfile.source,
      configPath,
      dataDir: currentConfig.dataDir,
    },
    'Config loaded',
  );

  // Inject claude config into process.env so the SDK picks it up
  if (currentConfig.claude?.apiKey && !isEnvVarUnset(currentConfig.claude.apiKey)) {
    process.env.ANTHROPIC_API_KEY = currentConfig.claude.apiKey;
  }
  if (currentConfig.claude?.baseUrl) {
    process.env.ANTHROPIC_BASE_URL = currentConfig.claude.baseUrl;
  }
  if (currentConfig.claude?.authToken) {
    process.env.ANTHROPIC_AUTH_TOKEN = currentConfig.claude.authToken;
  }

  const bus = new MessageBus();
  const store = new MessageStore(`${currentConfig.dataDir}/messages.db`);
  const dedup = new DedupCache();
  const archiver = new ConversationArchiver(currentConfig.dataDir);

  // Scan corp/ for tenant apps and their tool manifests.
  const corpDir = resolveCorpDir(process.cwd(), currentConfig.corpDir);
  const toolRegistry = new ToolRegistry(corpDir);
  toolRegistry.scan();

  // Load employee YAML configs and initialize EmployeeManager.
  const appServerMgr = new AppServerMgr();
  const employeeLoader = new EmployeeLoader({ corpDir });
  const loadedEmployees = employeeLoader.load();
  const skillBridge = new SkillBridge({ toolRegistry, appServerMgr, corpDir, skillToolBuilder: new SkillToolBuilder() });
  let employeeManagerRef: EmployeeManager | undefined;
  const memoryManager = new MemoryManager(currentConfig.dataDir, {
    subjectDirResolver: (subject, tenant) => {
      const employee = employeeManagerRef?.get(subject, tenant)?.app;
      if (employee) {
        return employee.workspace
          ? join(corpDir, employee.tenantName, employee.workspace)
          : join(corpDir, employee.tenantName, 'agents', employee.id);
      }
      const bot = currentConfig.bots[subject];
      if (bot) return resolve(bot.cwd ?? bot.agentDir);
      return undefined;
    },
  });
  const skillRunner = new SkillRunner({ toolRegistry, appServerMgr, corpDir, memoryManager });
  const employeeManager = new EmployeeManager({
    globalModel: currentConfig.claude?.model,
    globalBaseUrl: currentConfig.claude?.baseUrl,
    globalAuthToken: currentConfig.claude?.authToken,
    createAgent: (opts) => new ClaudeAgent(opts),
    skillBridge,
    corpDir,
    dataDir: currentConfig.dataDir,
    skillRunner,
  });
  employeeManagerRef = employeeManager;
  employeeManager.registerAll(loadedEmployees);
  if (loadedEmployees.length > 0) {
    logger.info({ employees: loadedEmployees.map((e) => e.id) }, 'Employee Manager initialized');
  }

  // Phase 3: Observability + Write Locks + Contract Chain Tracking
  const statsStore = new InMemoryStatsStore();
  const statsCollector = new StatsCollector(statsStore);
  const lockManager = new WriteLockManager({ enabled: true, defaultTTL: 300_000 }); // 5 min
  const chainTracker = new ContractChainTracker(new InMemoryChainStore());
  const traceStore = new TraceStore();

  // Phase 6: Orchestrator runner — bridges scheduler/chat to multi-agent handoff
  const contractsDb = new Database(`${currentConfig.dataDir}/contracts.db`);
  const contractStore = new ContractStore(contractsDb);
  const orchestratorRunner = new PMOOrchestratorRunner({
    employeeManager,
    chainTracker,
    bus,
    contractStore,
    traceStore,
    directorEnabled: currentConfig.claude?.directorEnabled ?? false,
    directorApiKey: currentConfig.claude?.apiKey,
    directorBaseUrl: currentConfig.claude?.baseUrl,
    directorModel: currentConfig.claude?.directorModel ?? 'claude-haiku-4-5',
    maxStackDepth: currentConfig.claude?.maxStackDepth ?? 5,
  });

  /**
   * Resolve the tenant name from a bot's agentDir.
   * Convention: agentDir ends with ".../corp/{tenantName}/.claude/agents/{botName}"
   * or contains "/corp/{tenantName}/" somewhere in the path.
   */
  function resolveTenant(agentDir: string): string | undefined {
    const match = agentDir.match(/(?:^|[\\/])corp[\\/](.+?)(?:[\\/]|$)/);
    return match?.[1];
  }

  // Mutable ref so agentFactory can reach the scheduler once it's created.
  // Agents are created lazily (first message), so the scheduler is always
  // available by the time any agent is constructed.
  const schedulerRef: { current: TaskScheduler | null } = { current: null };

  // Create channels per bot
  const channels: Record<string, ChannelAdapter> = {};
  for (const [name, botConfig] of Object.entries(currentBots)) {
    try {
      channels[name] = createChannel(botConfig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ bot: name, err: msg }, 'Failed to create channel');
    }
  }

  // Capability description is rebuilt on each message to pick up
  // newly installed apps without a server restart.
  function refreshCapabilityDesc(): string {
    return buildCapabilityDesc(currentBots);
  }

  // Create one ClaudeAgent per bot (each bot gets its own session/persona)
  const agents = new Map<string, ClaudeAgent>();
  // Per-agent recursion guard: prevent MCP tools from re-entering respond() infinitely
  const activeSessions = new Set<string>();
  const selectedEmployees = new Map<string, string>();
  const MAX_RECURSION_DEPTH = 3;
  const agentFactory = {
    async respond(
      prompt: string,
      chatId: string,
      botName: string,
      opts?: RespondOptions,
      _depth = 0,
    ): Promise<string> {
      if (_depth > MAX_RECURSION_DEPTH) {
        logger.warn({ botName, depth: _depth }, 'Recursion depth exceeded, aborting');
        return '已达到最大递归深度，停止执行。';
      }

      const sessionKey = `${botName}:${chatId}`;
      if (activeSessions.has(sessionKey)) {
        logger.warn({ botName, chatId }, 'Re-entrant session detected, returning empty');
        return '该会话正在处理中，请等待上一轮完成。';
      }
      activeSessions.add(sessionKey);
      const botConfig = currentBots[botName];
      try {

      if (botConfig?.routingMode) {
        opts?.onRoutingDecision?.({ mode: botConfig.routingMode });
      }

      // Parse slash commands for employee-director mode
      if (botConfig?.routingMode === 'employee-director' && botConfig.tenant && opts?.userId) {
        const { parseSlashCommand, buildSelectorResponse } = await import('./entry-router.js');
        const { EnterprisePeopleStore } = await import('./enterprise-people.js');
        const peopleStore = new EnterprisePeopleStore(corpDir);
        const person = peopleStore.list(botConfig.tenant).find(p => p.userId === opts.userId);
        const selectionKey = `${botName}:${opts.userId}`;

        const allEmployees = employeeManager.getEmployees()
          .filter((emp) => emp.app.tenantName === botConfig.tenant)
          .map((emp) => ({ id: emp.app.id, displayName: emp.app.displayName, oneLiner: emp.app.description?.split('\n')[0] }));
        const visibleEmployeeIds = person?.visibleEmployees ?? [];
        const visibleEmployees = visibleEmployeeIds.length > 0
          ? visibleEmployeeIds
              .map(id => {
                const emp = employeeManager.get(id, botConfig.tenant);
                if (!emp) return null;
                return { id: emp.app.id, displayName: emp.app.displayName, oneLiner: emp.app.description?.split('\n')[0] };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null)
          : allEmployees;

        const slashResult = parseSlashCommand(prompt, visibleEmployees);
        if (slashResult?.handled) {
          if (slashResult.targetEmployeeId) {
            selectedEmployees.set(selectionKey, slashResult.targetEmployeeId);
            opts?.onRoutingDecision?.({
              selectedEmployee: slashResult.targetEmployeeId,
              boundEmployee: slashResult.targetEmployeeId,
            });
            const persisted = peopleStore.bindAssistant(botConfig.tenant, opts.userId, {
              entryEmployee: slashResult.targetEmployeeId,
              routingMode: person?.routingMode ?? 'selector',
            });
            if (!persisted) {
              logger.warn(
                { botName, tenant: botConfig.tenant, userId: opts.userId, employeeId: slashResult.targetEmployeeId },
                'Failed to persist selected employee',
              );
            }
            return `${slashResult.response ?? '已切换数字员工'}\n\n请继续发送业务问题。`;
          }
          return slashResult.response ?? '';
        }

        const selectedEmployeeId = selectedEmployees.get(selectionKey);
        if (selectedEmployeeId && visibleEmployees.some((emp) => emp.id === selectedEmployeeId)) {
          const displayName = employeeManager.get(selectedEmployeeId, botConfig.tenant)?.app.displayName ?? selectedEmployeeId;
          opts?.onText?.(`⏳ 数字员工 ${displayName} 正在处理您的请求...`);
          opts?.onRoutingDecision?.({ selectedEmployee: selectedEmployeeId });
          return orchestratorRunner.respond(prompt, chatId, selectedEmployeeId, {
            preRoute: false,
            onHandoff: opts?.onHandoff,
          });
        }

        // No entryEmployee binding → show selector
        if (!person?.entryEmployee && visibleEmployees.length > 0) {
          opts?.onRoutingDecision?.({ selectorShown: true });
          return buildSelectorResponse(visibleEmployees);
        }
      }

      const enterpriseEntryAgent = resolveEnterpriseEntryAgent(botConfig, employeeManager, opts?.userId, prompt);
      if (enterpriseEntryAgent) {
        const displayName = employeeManager.get(enterpriseEntryAgent, botConfig?.tenant)?.app.displayName ?? enterpriseEntryAgent;
        opts?.onText?.(`⏳ 数字员工 ${displayName} 正在处理您的请求...`);
        opts?.onRoutingDecision?.({
          selectedEmployee: enterpriseEntryAgent,
          boundEmployee: enterpriseEntryAgent,
        });
        const result = await orchestratorRunner.respond(prompt, chatId, enterpriseEntryAgent, {
          preRoute: false,
          onHandoff: opts?.onHandoff,
        });
        return result;
      }

      // enterprise-director mode with no personal binding — prompt user to bind
      if (botConfig?.routingMode === 'employee-director') {
        opts?.onRoutingDecision?.({ selectorShown: false });
        return '您尚未绑定个人数字员工，请在企业员工页面完成绑定后重试。';
      }

      // If this is an employee agent with allowedTargets, route through
      // the multi-agent orchestrator (digital employee network handoff).
      if (employeeManager.has(botName, opts?.tenant)) {
        const ea = employeeManager.get(botName, opts?.tenant);
        if (ea && ea.app.allowedTargets.length > 0) {
          opts?.onRoutingDecision?.({ selectedEmployee: botName });
          if (opts?.handoffMode === 'disabled') {
            const response = await ea.protocol.execute(prompt, { chatId });
            return response.text;
          }
          return orchestratorRunner.respond(prompt, chatId, botName, {
            preRoute: false,
            onHandoff: opts?.onHandoff,
          });
        }
      }

      const agentCacheKey = runtimeAgentCacheKey(botName, opts?.runtimeAgentDir, opts?.runtimeCwd);
      let agent = agents.get(agentCacheKey);
      if (!agent && employeeManager.has(botName, opts?.tenant)) {
        // Employee pre-check: use Employee-configured agent with SkillBridge tools
        agent = employeeManager.getAgent(botName, opts?.tenant)!;
        agents.set(agentCacheKey, agent);
      }
      if (!agent) {
        if (opts?.runtimeAgentDir) {
          const agentDir = opts.runtimeAgentDir;
          const workdir = opts.runtimeCwd ?? opts.runtimeAgentDir;
          initWorkdir(agentDir);
          initWorkdir(workdir);
          agent = new ClaudeAgent({
            name: botName,
            agentDir,
            cwd: workdir,
            model: currentConfig.claude?.model,
            baseUrl: currentConfig.claude?.baseUrl,
            authToken: currentConfig.claude?.authToken,
          });
        } else if (botConfig) {
          const workdir = botConfig.cwd ?? botConfig.agentDir;
          initWorkdir(workdir);
          agent = new ClaudeAgent({
            name: botName,
            agentDir: botConfig.agentDir,
            cwd: workdir,
            model: botConfig.model ?? currentConfig.claude?.model,
            baseUrl: botConfig.baseUrl ?? currentConfig.claude?.baseUrl,
            authToken: botConfig.authToken ?? currentConfig.claude?.authToken,
          });
        } else {
          // Fallback: create a default web agent using global model config
          const webDir = `${currentConfig.dataDir}/agents/web`;
          initWorkdir(webDir);
          agent = new ClaudeAgent({
            name: 'web',
            agentDir: webDir,
            cwd: webDir,
            model: currentConfig.claude?.model,
            baseUrl: currentConfig.claude?.baseUrl,
            authToken: currentConfig.claude?.authToken,
          });
        }
        agents.set(agentCacheKey, agent);
      }

      // Inject capability desc for group chat context (rebuilt each message)
      const desc = refreshCapabilityDesc();
      const finalPrompt = desc
        ? `${desc}\n\n---\n\n${prompt}`
        : prompt;

      const mcpServers: Record<string, McpSdkServerConfigWithInstance> = {
        platform: buildPlatformMcpServer({
          botName,
          chatId,
          memory: memoryManager,
          bus,
          scheduler: schedulerRef.current ?? undefined,
          onMemoryOp: opts?.onMemoryOp,
        }),
      };

      // Inject tenant MCP server if the bot belongs to a tenant
      const tenantName = botConfig ? resolveTenant(botConfig.agentDir) : opts?.tenant;
      if (tenantName && !employeeManager.has(botName)) {
        const summaries = toolRegistry.getSkillSummaries(tenantName);
        if (summaries.length > 0) {
          mcpServers['tenant-tools'] = buildTenantMcpServer(tenantName, {
            tenantName,
            summaries,
            onLoadSkillTools: async (skillName: string) =>
              toolRegistry.getSkillTools(tenantName, skillName),
          });
        }
      }

      // Inject knowledge MCP (vector + markdown dual-channel)
      const knowledgeBaseUrl = process.env.OPENVIKING_URL ?? 'http://127.0.0.1:1933';
      mcpServers['knowledge'] = buildKnowledgeMcpServer({
        baseUrl: knowledgeBaseUrl,
        corpDir,
      });

      const respondOpts: Record<string, unknown> = { mcpServers };

      const reply = await agent.respond(finalPrompt, chatId, {
        ...opts,
        ...respondOpts,
      } as Parameters<typeof agent.respond>[2]);

      // Archive conversation if threshold reached (fire-and-forget)
      archiver
        .maybeArchive(botName, chatId, store)
        .catch((err) =>
          logger.warn({ err }, 'Archive failed'),
        );

      return reply;
      } finally {
        activeSessions.delete(sessionKey);
      }
    },
    clearSession(chatId: string, botName: string, userId?: string): boolean {
      const agent = agents.get(botName);
      return agent?.clearSession(chatId, userId) ?? false;
    },
    clearAllSessions(botName: string): number {
      const agent = agents.get(botName);
      return agent?.clearAllSessions() ?? 0;
    },
    listSessions(botName: string): string[] {
      const agent = agents.get(botName);
      return agent?.listSessions() ?? [];
    },
  };

  const botManager = new BotManager({
    config: { bots: currentBots },
    agentFactory,
    bus,
    store,
    dedup,
    corpDir,
    employeeManager,
  });
  await botManager.start(channels);

  // Eagerly create agents so sessions/workdir are available immediately
  for (const [name, botConfig] of Object.entries(currentBots)) {
    if (agents.has(name)) continue;
    const workdir = botConfig.cwd ?? botConfig.agentDir;
    initWorkdir(workdir);
    const agent = new ClaudeAgent({
      name,
      agentDir: botConfig.agentDir,
      cwd: workdir,
      model: botConfig.model ?? currentConfig.claude?.model,
      baseUrl: botConfig.baseUrl ?? currentConfig.claude?.baseUrl,
      authToken: botConfig.authToken ?? currentConfig.claude?.authToken,
    });
    agents.set(name, agent);
    logger.info({ bot: name, sessions: agent.listSessions().length }, 'Agent pre-created');
  }

  const scheduler = new TaskScheduler(store, agentFactory, orchestratorRunner);
  schedulerRef.current = scheduler;
  scheduler.start();

  // Initialize EventBridge to connect domain events to agent execution
  const eventBridge = new EventBridge({ bus, agent: agentFactory });
  eventBridge.registerEmployeeEventTriggers(loadedEmployees);

  const web = process.env.HAPPYCOMPANY_NO_WEB === '1'
    ? { stop: async () => {} }
    : startWebServer({
        port: currentConfig.web.port,
        dataDir: currentConfig.dataDir,
        skillsDir: `${currentConfig.dataDir}/skills`,
        botManager,
        store,
        bus,
        adminToken: currentConfig.adminToken,
        configRef,
        scheduler,
        configPath,
        keyPath,
        agentFactory,
        corpDir,
        traceStore,
        // Phase 6: Pass real data sources
        statsCollector,
        statsStore,
        chainTracker,
        lockManager,
        employeeManager,
        toolRegistry,
        contractStore,
        orchestratorRunner,
      });
  logger.info(
    { ui: process.env.HAPPYCOMPANY_NO_WEB === '1' ? 'disabled' : `http://localhost:${currentConfig.web.port}/` },
    'HappyCompany running',
  );

  // ── Config hot reload ─────────────────────────────────────
  const handleConfigChange = debounce(async () => {
    logger.info('Config file changed, reloading...');
    try {
      const newConfig = applyRuntimeProfileDefaults(reloadConfig(configPath, keyPath), runtimeProfile);
      normalizeAdminToken(newConfig);
      const delta = diffConfigs(currentConfig, newConfig);

      if (delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0) {
        logger.info('No bot changes detected');
        currentConfig = newConfig;
        configRef.current = newConfig;
        // Re-inject claude env vars even when only claude section changed
        if (newConfig.claude?.baseUrl) process.env.ANTHROPIC_BASE_URL = newConfig.claude.baseUrl;
        if (newConfig.claude?.authToken) process.env.ANTHROPIC_AUTH_TOKEN = newConfig.claude.authToken;
        if (newConfig.claude?.apiKey && !isEnvVarUnset(newConfig.claude.apiKey)) process.env.ANTHROPIC_API_KEY = newConfig.claude.apiKey;
        // Update existing agents with new global claude defaults (if bot has no per-bot override)
        for (const [name, agent] of agents) {
          const bot = newConfig.bots[name];
          if (!bot) continue;
          agent.updateOptions({
            model: bot.model ?? newConfig.claude?.model,
            baseUrl: bot.baseUrl ?? newConfig.claude?.baseUrl,
            authToken: bot.authToken ?? newConfig.claude?.authToken,
          });
        }
        return;
      }

      logger.info({ delta }, 'Applying config delta');

      for (const name of delta.removed) {
        await botManager.removeBot(name);
      }

      for (const name of delta.changed) {
        await botManager.removeBot(name);
      }

      currentBots = botsWithNames(newConfig);
      botManager.updateBotConfig(currentBots);
      currentConfig = newConfig;
      configRef.current = newConfig;

      for (const name of [...delta.added, ...delta.changed]) {
        const botConfig = currentBots[name];
        const channel = createChannel(botConfig);
        await botManager.addBot(name, channel);
      }

      bus.publish({ type: 'config_reloaded' });
      logger.info('Config reloaded successfully');
    } catch (err) {
      logger.error({ err }, 'Config reload failed — keeping old config');
    }
  }, 300);

  watchFile(configPath, { persistent: false }, () => {
    handleConfigChange();
  });

  // Watch corp/ for employee YAML changes (hot reload employee managers)
  const handleAppChange = debounce(async () => {
    logger.info('Employee YAML change detected, reloading...');
    try {
      const currentEmployees = employeeManager.getEmployees().map((employee) => employee.app);
      const delta = employeeLoader.reload(currentEmployees);

      for (const emp of delta.removed) {
        employeeManager.remove(emp.id);
        agents.delete(emp.id);
        logger.info({ employeeId: emp.id }, 'Employee removed');
      }

      for (const emp of delta.changed) {
        employeeManager.remove(emp.id);
        agents.delete(emp.id);
        employeeManager.register(emp);
        logger.info({ employeeId: emp.id }, 'Employee re-registered');
      }

      for (const emp of delta.added) {
        employeeManager.register(emp);
        logger.info({ employeeId: emp.id }, 'Employee added');
      }

      if (delta.added.length || delta.removed.length || delta.changed.length) {
        logger.info(
          { added: delta.added.length, removed: delta.removed.length, changed: delta.changed.length },
          'Employee reload complete',
        );
      }
    } catch (err) {
      logger.error({ err }, 'Employee reload failed');
    }
  }, 500);

  try {
    const { existsSync } = await import('node:fs');
    if (existsSync(corpDir)) {
      watch(corpDir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
          handleAppChange();
        }
      });
      logger.info({ corpDir }, 'Watching employee YAML configs for changes');
    }
  } catch (err) {
    logger.warn({ err, corpDir }, 'Failed to watch corp/ directory for employee YAML changes');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    eventBridge.stop();
    scheduler.stop();
    await web.stop();
    await botManager.stop();
    store.close();
    // SIGKILL safety net: if SDK subprocesses prevent process.exit(),
    // force-terminate after 5s. Must be a ref'd timer so it fires even
    // if the event loop is blocked. Reference: happyclaw forceExitWithSafetyNet.
    setTimeout(() => {
      logger.error('[shutdown] process.exit() did not terminate, forcing SIGKILL');
      process.kill(process.pid, 'SIGKILL');
    }, 5000);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
