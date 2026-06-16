import type { Hono } from 'hono';
import type { BotManager } from './bot.js';
import type { StatsCollector, AgentStats } from './orchestrator/stats.js';
import type { StatsStore } from './orchestrator/stats.js';
import type { ContractChainTracker } from './orchestrator/contract-chain.js';
import type { WriteLockManager } from './orchestrator/write-lock.js';
import type { EmployeeManager } from './orchestrator/employee-colony.js';

export interface BusinessDeps {
  botManager: BotManager;
  statsCollector?: StatsCollector;
  statsStore?: StatsStore;
  chainTracker?: ContractChainTracker;
  lockManager?: WriteLockManager;
  employeeManager?: EmployeeManager;
}

interface AgentStatus {
  name: string;
  displayName: string;
  status: 'running' | 'stopped';
  channel: string;
  workdir: string;
  model: string;
  sessionCount: number;
}

interface ChannelSummary {
  name: string;
  botCount: number;
  bots: Array<{ name: string; displayName: string; status: string }>;
}

interface ContractChainResponse {
  agents: AgentStatus[];
  channels: ChannelSummary[];
}

/**
 * Register business-facing API routes under /api/business/*.
 * These routes provide agent status monitoring and contract chain
 * visibility for business operators (not admin/developer endpoints).
 */
export function registerBusinessRoutes(app: Hono, deps: BusinessDeps): void {
  const { botManager } = deps;

  // ── Agent status list ─────────────────────────────────

  app.get('/api/business/agents', (c) => {
    const botInfos = botManager.getBotInfos();

    const agents: AgentStatus[] = botInfos
      .map((info) => ({
        name: info.name,
        displayName: info.displayName,
        status: info.status,
        channel: info.channel,
        workdir: info.workdir,
        model: info.model,
        sessionCount: botManager.listSessions(info.name).length,
      }))
      .sort((a, b) => {
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (a.status !== 'running' && b.status === 'running') return 1;
        return a.displayName.localeCompare(b.displayName);
      });

    return c.json({ agents });
  });

  // ── Single agent detail ──────────────────────────────

  app.get('/api/business/agents/:name', (c) => {
    const name = c.req.param('name');
    const config = botManager.getBotConfig(name);

    if (!config) {
      return c.json({ error: `Agent "${name}" not found` }, 404);
    }

    const info = botManager.getBotInfos().find((b) => b.name === name);
    const sessions = botManager.listSessions(name);

    return c.json({
      name,
      displayName: config.displayName || name,
      status: info?.status ?? 'stopped',
      channel: config.channel,
      workdir: config.cwd || config.agentDir,
      model: info?.model || 'default',
      sessions,
    });
  });

  // ── Agent sessions ───────────────────────────────────

  app.get('/api/business/agents/:name/sessions', (c) => {
    const name = c.req.param('name');
    const config = botManager.getBotConfig(name);

    if (!config) {
      return c.json({ error: `Agent "${name}" not found` }, 404);
    }

    const sessions = botManager.listSessions(name);
    return c.json({ sessions });
  });

  // ── Clear agent sessions ─────────────────────────────

  app.post('/api/business/agents/:name/clear-sessions', (c) => {
    const name = c.req.param('name');
    const config = botManager.getBotConfig(name);

    if (!config) {
      return c.json({ error: `Agent "${name}" not found` }, 404);
    }

    const cleared = botManager.clearBotSessions(name);
    return c.json({ name, cleared });
  });

  // ── Channel summary ──────────────────────────────────

  app.get('/api/business/channels', (c) => {
    const botInfos = botManager.getBotInfos();

    const channelMap = new Map<string, ChannelSummary>();

    for (const info of botInfos) {
      const existing = channelMap.get(info.channel) ?? {
        name: info.channel,
        botCount: 0,
        bots: [],
      };

      channelMap.set(info.channel, {
        ...existing,
        botCount: existing.botCount + 1,
        bots: [
          ...existing.bots,
          { name: info.name, displayName: info.displayName, status: info.status },
        ],
      });
    }

    const channels = Array.from(channelMap.values());
    return c.json({ channels });
  });

  // ── Contract chain overview ──────────────────────────

  app.get('/api/business/contract-chain', (c) => {
    const botInfos = botManager.getBotInfos();

    const agents: AgentStatus[] = botInfos.map((info) => ({
      name: info.name,
      displayName: info.displayName,
      status: info.status,
      channel: info.channel,
      workdir: info.workdir,
      model: info.model,
      sessionCount: botManager.listSessions(info.name).length,
    }));

    const channelMap = new Map<string, ChannelSummary>();
    for (const info of botInfos) {
      const existing = channelMap.get(info.channel) ?? {
        name: info.channel,
        botCount: 0,
        bots: [],
      };

      channelMap.set(info.channel, {
        ...existing,
        botCount: existing.botCount + 1,
        bots: [
          ...existing.bots,
          { name: info.name, displayName: info.displayName, status: info.status },
        ],
      });
    }

    const channels = Array.from(channelMap.values());

    const response: ContractChainResponse = { agents, channels };
    return c.json(response);
  });

  // ── Stats API (Phase 6) ────────────────────────────────

  app.get('/api/business/stats', (c) => {
    if (!deps.statsStore) {
      return c.json({ stats: [] });
    }

    const from = c.req.query('from');
    const to = c.req.query('to');

    let stats: AgentStats[];
    if (from && to) {
      stats = deps.statsStore.getStatsForRange(parseInt(from, 10), parseInt(to, 10));
    } else {
      stats = deps.statsStore.listAllAgentStats();
    }

    return c.json({ stats });
  });

  app.get('/api/business/stats/:agentId', (c) => {
    if (!deps.statsStore) {
      return c.json({ error: 'Stats not available' }, 503);
    }

    const agentId = c.req.param('agentId');
    const stats = deps.statsStore.getAgentStats(agentId);

    if (stats.callCount === 0 && stats.runCount === 0) {
      return c.json({ error: `No stats found for agent "${agentId}"` }, 404);
    }

    return c.json(stats);
  });

  // ── Contract Events API (Phase 6) ───────────────────────

  app.get('/api/business/contract-events', (c) => {
    if (!deps.chainTracker) {
      return c.json({ events: [], contracts: [] });
    }

    const contractId = c.req.query('contractId');
    const agentId = c.req.query('agentId');
    const from = c.req.query('from');
    const to = c.req.query('to');

    if (contractId) {
      const events = deps.chainTracker.getChain(contractId, agentId || undefined);
      return c.json({ events });
    }

    if (from && to) {
      const contracts = deps.chainTracker.listContractsWithActivity(parseInt(from, 10), parseInt(to, 10));
      return c.json({ contracts });
    }

    return c.json({ events: [], contracts: [] });
  });

  // ── Write Locks API (Phase 6) ──────────────────────────

  app.get('/api/business/locks', (c) => {
    if (!deps.lockManager) {
      return c.json({ locks: [] });
    }

    const agentId = c.req.query('agentId');
    const entity = c.req.query('entity');

    let locks;
    if (agentId) {
      locks = deps.lockManager.getAgentLocks(agentId);
    } else {
      locks = deps.lockManager.getAllLocks();
    }

    const filtered = entity ? locks.filter(l => l.entity === entity) : locks;

    return c.json({ locks: filtered });
  });

  // ── Employee API (Phase 6) ───────────────────────────────

  app.get('/api/business/employees', (c) => {
    if (!deps.employeeManager) {
      return c.json({ employees: [], count: 0 });
    }

    const employees = deps.employeeManager.getEmployees().map((emp) => ({
      id: emp.app.id,
      role: emp.app.role,
      tenant: emp.app.tenantName,
      model: emp.app.model,
    }));

    return c.json({ employees, count: employees.length });
  });

  app.get('/api/business/employees/:id', (c) => {
    if (!deps.employeeManager) {
      return c.json({ error: 'Employee manager not available' }, 503);
    }

    const id = c.req.param('id');
    const emp = deps.employeeManager.get(id);

    if (!emp) {
      return c.json({ error: `Employee "${id}" not found` }, 404);
    }

    return c.json({
      id,
      role: emp.app.role,
      model: emp.app.model,
      workspace: emp.app.workspace,
      tools: emp.app.tools,
      skills: emp.app.skills,
    });
  });
}
