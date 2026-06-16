import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { registerBusinessRoutes } from './business-api.js';
import { registerEmployeeRoutes } from './orchestrator/employee-api.js';
import { EmployeeGenerator } from './orchestrator/employee-generator.js';
import { SkillFactory } from './orchestrator/skill-factory.js';
import { attachWebSocket } from './ws.js';
import { registerPublicRoutes } from './routes/public-routes.js';
import { registerAdminConfigRoutes } from './routes/admin-config.js';
import { registerAdminSkillsRoutes } from './routes/admin-skills.js';
import { registerAdminOperationsRoutes } from './routes/admin-operations.js';
import { registerTenantRoutes } from './routes/admin-tenants.js';
import { registerAdminKnowledgeRoutes } from './routes/admin-knowledge.js';
import { registerOrchestrationRoutes } from './routes/orchestration.js';
import { registerBotBindingRoutes } from './routes/bot-bindings.js';
import { registerEnterprisePeopleRoutes } from './routes/enterprise-people.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerWorkdirRoutes } from './routes/workdir.js';
import { registerCollaborateRoutes } from './routes/collaborate.js';
import { registerHarnessRoutes } from './routes/harness.js';
import { registerAgentBuilderRoutes } from './routes/agent-builder.js';
import { registerCapabilityRoutes } from './routes/capabilities.js';
import { registerRuntimeRoutes } from './routes/runtime-routes.js';
import { loadWorkdir } from './workdir.js';
import { MemoryManager } from './memory.js';
import type { BotManager, BotInfo } from './bot.js';
import type { MessageStore } from './store.js';
import type { MessageBus } from './bus.js';
import { isEnvVarUnset, type Config } from './config.js';
import type { TaskScheduler } from './scheduler.js';
import type { ContractStore } from './orchestrator/contract-store.js';
import type { PMOOrchestratorRunner } from './orchestrator/orchestrator-runner.js';
import type { StatsCollector, StatsStore } from './orchestrator/stats.js';
import type { ContractChainTracker } from './orchestrator/contract-chain.js';
import type { WriteLockManager } from './orchestrator/write-lock.js';
import type { EmployeeManager } from './orchestrator/employee-colony.js';
import type { TraceStore } from './orchestrator/trace-store.js';
import type { ToolRegistry } from './tool-registry.js';
import { StepRunStore } from './harness/step-run-store.js';

export interface MutableRef<T> {
  current: T;
}

interface WebDeps {
  port: number;
  dataDir: string;
  skillsDir: string;
  botManager: BotManager;
  store: MessageStore;
  bus: MessageBus;
  adminToken?: string;
  configRef: MutableRef<Config>;
  scheduler?: TaskScheduler;
  agentFactory: import('./bot.js').AgentFactory;
  configPath: string;
  keyPath: string;
  corpDir: string;
  statsCollector?: StatsCollector;
  statsStore?: StatsStore;
  chainTracker?: ContractChainTracker;
  lockManager?: WriteLockManager;
  employeeManager?: EmployeeManager;
  toolRegistry?: ToolRegistry;
  traceStore?: TraceStore;
  contractStore?: ContractStore;
  orchestratorRunner?: PMOOrchestratorRunner;
}

export function startWebServer(deps: WebDeps): { stop: () => Promise<void> } {
  const app = new Hono();
  const memoryManager = new MemoryManager(deps.dataDir, {
    subjectDirResolver: (subject, tenant) => {
      const employee = deps.employeeManager?.get(subject, tenant)?.app;
      if (employee) {
        return employee.workspace
          ? join(deps.corpDir, employee.tenantName, employee.workspace)
          : join(deps.corpDir, employee.tenantName, 'agents', employee.id);
      }
      const bot = deps.botManager.getBotConfig(subject);
      if (bot) return resolve(bot.cwd ?? bot.agentDir);
      return undefined;
    },
  });
  app.use('*', cors());

  const normalizedDataDir = resolve(deps.dataDir);
  const stepRunStore = new StepRunStore();

  function validateWorkdirPath(raw: string): string | null {
    const resolved = resolve(raw);
    if (!resolved.startsWith(normalizedDataDir + '/') && resolved !== normalizedDataDir) {
      return null;
    }
    return resolved;
  }

  // ── Admin auth middleware ────────────────────────────

  const effectiveAdminToken = deps.adminToken && !isEnvVarUnset(deps.adminToken)
    ? deps.adminToken
    : undefined;

  function isSetupConfigured(): boolean {
    const config = deps.configRef.current;
    const apiKeySet = !!config.claude?.apiKey && !isEnvVarUnset(config.claude.apiKey);
    const thirdPartySet = !!config.claude?.baseUrl && !!config.claude?.authToken;
    return (apiKeySet || thirdPartySet) && Object.keys(config.bots).length > 0;
  }

  function isPublicApiPath(c: Context): boolean {
    const path = new URL(c.req.url).pathname;
    if (path === '/api/health') return true;
    if (path === '/api/admin/session') return true;
    if (path === '/api/setup/status') return true;
    if (path === '/api/setup/config' && c.req.method === 'POST' && !isSetupConfigured()) return true;
    return false;
  }

  if (effectiveAdminToken) {
    const adminAuth = async (c: Context, next: Next) => {
      if (isPublicApiPath(c)) {
        await next();
        return;
      }
      const authHeader = c.req.header('Authorization');
      if (!authHeader || authHeader !== `Bearer ${effectiveAdminToken}`) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
    };
    app.use('/api/*', adminAuth);
    logger.info('Admin API auth enabled (Bearer token)');
  }

  // ── Public routes ───────────────────────────────────

  registerPublicRoutes(app, {
    botManager: deps.botManager,
    store: deps.store,
    dataDir: deps.dataDir,
    corpDir: deps.corpDir,
    configRef: deps.configRef,
    employeeManager: deps.employeeManager,
  });

  registerRuntimeRoutes(app, {
    corpDir: deps.corpDir,
    configRef: deps.configRef,
    employeeManager: deps.employeeManager,
    store: deps.store,
    agentFactory: deps.agentFactory,
    bus: deps.bus,
  });

  app.get('/api/admin/session', (c) => {
    if (effectiveAdminToken) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || authHeader !== `Bearer ${effectiveAdminToken}`) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    return c.json({
      authenticated: true,
      mode: effectiveAdminToken ? 'protected' : 'development',
    });
  });

  app.post('/api/admin/clear-messages', (c) =>
    c.json({ cleared: deps.store.clearAll() }),
  );

  // ── Admin: workdir inspection ────────────────────────

  app.get('/api/admin/workdir/:path{.+}', (c) => {
    const workdirPath = c.req.param('path');
    const absPath = resolve(workdirPath);
    try {
      if (!existsSync(absPath)) return c.json({ error: 'Not found' }, 404);
      const hasClaudeMd = existsSync(join(absPath, 'CLAUDE.md'));
      const skillsDir = join(absPath, '.claude', 'skills');
      const hasSkills = existsSync(skillsDir);
      const info = loadWorkdir(absPath);
      return c.json({ path: workdirPath, exists: true, hasClaudeMd, hasSkills, initialized: info !== null });
    } catch { return c.json({ error: 'Read failed' }, 500); }
  });

  // ── Extracted admin route modules ────────────────────

  registerAdminConfigRoutes(app, {
    bus: deps.bus,
    configRef: deps.configRef,
    configPath: deps.configPath,
    keyPath: deps.keyPath,
    corpDir: deps.corpDir,
  });

  registerAdminSkillsRoutes(app, {
    skillsDir: deps.skillsDir,
    botManager: deps.botManager,
    corpDir: deps.corpDir,
  });

  registerAdminKnowledgeRoutes(app, {
    corpDir: deps.corpDir,
  });

  registerAdminOperationsRoutes(app, {
    dataDir: deps.dataDir,
    store: deps.store,
    scheduler: deps.scheduler,
    memoryManager,
  });

  // ── Workdir management ───────────────────────────────

  app.get('/api/admin/workdirs', (c) => {
    try {
      const botInfos = deps.botManager.getBotInfos();
      const seen = new Map<string, BotInfo[]>();
      for (const bot of botInfos) {
        const existing = seen.get(bot.workdir) ?? [];
        existing.push(bot);
        seen.set(bot.workdir, existing);
      }
      const workdirs = Array.from(seen.entries()).map(([dir, bots]) => {
        const info = loadWorkdir(dir);
        return { path: dir, info, bots };
      });
      return c.json(workdirs.filter(w => w.info !== null));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── Bot session management ───────────────────────────

  app.post('/api/admin/bots/:name/clear-sessions', (c) => {
    const name = c.req.param('name');
    try {
      const cleared = deps.botManager.clearBotSessions(name);
      return c.json({ name, cleared });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.get('/api/admin/bots/:name/sessions', (c) => {
    const name = c.req.param('name');
    try {
      // Use DB as primary source — agent memory sessions are ephemeral
      const chats = deps.store.listChats(name);
      const sessions = chats.map((chat) => {
        const recentMessages = deps.store.listMessages(chat.chatId, 3);
        return {
          chatId: chat.chatId,
          messageCount: chat.messageCount ?? 0,
          lastMessageAt: chat.lastMessageAt ?? 0,
          preview: recentMessages.map((m) => m.text.slice(0, 100)).join(' | '),
        };
      });
      return c.json({ sessions });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/api/admin/bots/:name/sessions/:chatId', (c) => {
    const name = c.req.param('name');
    const chatId = c.req.param('chatId');
    try {
      const cleared = deps.botManager.clearSessionSingle(name, chatId);
      return c.json({ cleared });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ── Knowledge base ──────────────────────────────────

  app.get('/api/admin/bots/:name/knowledge', (c) => {
    const name = c.req.param('name');
    const botConfig = deps.botManager.getBotConfig(name);
    if (!botConfig) return c.json({ error: 'Bot not found' }, 404);
    const workdir = botConfig.cwd ?? botConfig.agentDir;
    const knowledgeDir = join(workdir, 'knowledge');
    if (!existsSync(knowledgeDir)) {
      return c.json({ files: [], path: knowledgeDir });
    }
    const entries = readdirSync(knowledgeDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => ({
        name: e.name,
        size: statSync(join(knowledgeDir, e.name)).size,
      }));
    return c.json({ files, path: knowledgeDir });
  });

  app.delete('/api/admin/bots/:name/knowledge/:filename', (c) => {
    const name = c.req.param('name');
    const filename = c.req.param('filename');
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return c.json({ error: 'Invalid filename' }, 400);
    }
    const botConfig = deps.botManager.getBotConfig(name);
    if (!botConfig) return c.json({ error: 'Bot not found' }, 404);
    const workdir = botConfig.cwd ?? botConfig.agentDir;
    const knowledgeDir = join(workdir, 'knowledge');
    const filePath = join(knowledgeDir, filename);
    if (!existsSync(filePath)) return c.json({ error: 'File not found' }, 404);
    unlinkSync(filePath);
    return c.json({ deleted: true });
  });

  // ── Tenant management ──────────────────────────────────

  registerTenantRoutes(app, { corpDir: deps.corpDir });
  registerTemplateRoutes(app, { corpDir: deps.corpDir });
  registerWorkdirRoutes(app, { corpDir: deps.corpDir });
  registerCollaborateRoutes(app, { employeeManager: deps.employeeManager });
  registerBotBindingRoutes(app, {
    botManager: deps.botManager,
    configRef: deps.configRef,
    configPath: deps.configPath,
    keyPath: deps.keyPath,
    corpDir: deps.corpDir,
  });
  registerEnterprisePeopleRoutes(app, {
    corpDir: deps.corpDir,
    ...(deps.employeeManager
      ? { employeeExists: (tenant: string, employeeId: string) => deps.employeeManager!.has(employeeId, tenant) }
      : {}),
  });
  registerOrchestrationRoutes(app, { traceStore: deps.traceStore });
  registerHarnessRoutes(app, {
    agentFactory: deps.agentFactory,
    store: deps.store,
    bus: deps.bus,
    stepRunStore,
    corpDir: deps.corpDir,
    configRef: deps.configRef,
    employeeManager: deps.employeeManager,
  });
  if (deps.toolRegistry) {
    registerCapabilityRoutes(app, {
      corpDir: deps.corpDir,
      toolRegistry: deps.toolRegistry,
      employeeManager: deps.employeeManager,
    });
    registerAgentBuilderRoutes(app, {
      dataDir: deps.dataDir,
      corpDir: deps.corpDir,
      toolRegistry: deps.toolRegistry,
      employeeManager: deps.employeeManager,
      agentFactory: deps.agentFactory,
      store: deps.store,
      bus: deps.bus,
    });
  }

  // ── Sub-route mounting ────────────────────────────────

  registerBusinessRoutes(app, {
    botManager: deps.botManager,
    statsCollector: deps.statsCollector,
    statsStore: deps.statsStore,
    chainTracker: deps.chainTracker,
    lockManager: deps.lockManager,
    employeeManager: deps.employeeManager,
  });

  const skillFactory = new SkillFactory(deps.corpDir);
  const generator = new EmployeeGenerator({
    anthropicApiKey: deps.configRef.current.claude?.apiKey ?? '',
    anthropicBaseUrl: deps.configRef.current.claude?.baseUrl,
    anthropicAuthToken: deps.configRef.current.claude?.authToken,
    corpDir: deps.corpDir,
    skillFactory,
  });
  registerEmployeeRoutes(app, {
    generator,
    skillFactory,
    employeeManager: deps.employeeManager,
    traceStore: deps.traceStore,
    corpDir: deps.corpDir,
    tenant: 'acme',
  });

  // ── SPA static file serving (production) ───────────────

  const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  if (existsSync(join(distDir, 'index.html'))) {
    const mimeTypes: Record<string, string> = {
      js: 'application/javascript',
      css: 'text/css',
      html: 'text/html',
      json: 'application/json',
      png: 'image/png',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    };

    const normalizedDistDir = resolve(distDir);
    app.use('*', async (c, next) => {
      if (c.req.path.startsWith('/api/')) return next();
      const filePath = join(distDir, c.req.path);
      if (!filePath.startsWith(normalizedDistDir + '/') && filePath !== normalizedDistDir) {
        return c.text('Not Found', 404);
      }
      const noCache = {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      };
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = c.req.path.split('.').pop();
        return c.text(readFileSync(filePath, 'utf-8'), 200, {
          'Content-Type': mimeTypes[ext ?? ''] ?? 'application/octet-stream',
          ...noCache,
        });
      }
      return c.html(readFileSync(join(distDir, 'index.html'), 'utf-8'), 200, noCache);
    });
    logger.info({ distDir }, 'Serving production SPA');
  }

  // ── Start server ─────────────────────────────────────

  const server = serve({ fetch: app.fetch, port: deps.port, hostname: '127.0.0.1' });
  attachWebSocket(server, deps.bus, {
    agentFactory: deps.agentFactory,
    store: deps.store,
    bus: deps.bus,
    corpDir: deps.corpDir,
    configRef: deps.configRef,
    employeeManager: deps.employeeManager,
    handleCommand: (botName, chatId, text) => {
      const botConfig = deps.botManager.getBotConfig(botName);
      if (botConfig?.routingMode === 'employee-director') return Promise.resolve(null);
      return deps.botManager.handleCommand(botName, chatId, text);
    },
  });
  logger.info({ port: deps.port }, 'Web server started');

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
