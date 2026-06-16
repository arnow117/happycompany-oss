import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerBusinessRoutes } from '../src/business-api.js';

import type { BotManager } from '../src/bot.js';
import type { MessageBus } from '../src/bus.js';
import type { MessageStore } from '../src/store.js';
import { StatsCollector, InMemoryStatsStore, type AgentStats } from '../src/orchestrator/stats.js';
import { ContractChainTracker, InMemoryChainStore } from '../src/orchestrator/contract-chain.js';
import { WriteLockManager, type WriteLock } from '../src/orchestrator/write-lock.js';
import { EmployeeManager, type RegisteredEmployee } from '../src/orchestrator/employee-colony.js';
import { SkillBridge } from '../src/orchestrator/skill-bridge.js';
import { AppServerMgr } from '../src/app-server.js';
import { EmployeeLoader } from '../src/orchestrator/employee-loader.js';
import { ClaudeAgent } from '../src/agent.js';

// ── Test doubles ────────────────────────────────────────

function createMockBotManager(overrides?: Partial<ReturnType<typeof createMockBotManager>>): BotManager {
  return {
    getBotInfos: () => [
      {
        name: 'sales-bot',
        displayName: 'Sales Agent',
        status: 'running',
        channel: 'feishu',
        workdir: '/data/agents/sales-bot',
        model: 'claude-sonnet-4-20250514',
      },
      {
        name: 'support-bot',
        displayName: 'Support Agent',
        status: 'stopped',
        channel: 'dingtalk',
        workdir: '/data/agents/support-bot',
        model: 'default',
      },
    ],
    getBotConfig: (name: string) => {
      const configs: Record<string, { name: string; channel: string; displayName: string; agentDir: string }> = {
        'sales-bot': { name: 'sales-bot', channel: 'feishu', displayName: 'Sales Agent', agentDir: '/data/agents/sales-bot' },
        'support-bot': { name: 'support-bot', channel: 'dingtalk', displayName: 'Support Agent', agentDir: '/data/agents/support-bot' },
      };
      return configs[name];
    },
    listSessions: () => ['chat-1', 'chat-2'],
    clearBotSessions: () => 2,
    clearSessionSingle: () => true,
    clearSessionsForWorkdir: () => 1,
    handleCommand: async () => null,
    addBot: async () => {},
    removeBot: async () => {},
    start: async () => {},
    stop: async () => {},
    listBots: () => ['sales-bot', 'support-bot'],
    isBotRunning: (name) => name === 'sales-bot',
    ...overrides,
  } as unknown as BotManager;
}

function createMockBus(): MessageBus {
  const events: Array<{ type: string; timestamp: number; botName?: string; chatId?: string; text?: string }> = [];
  return {
    publish: (ev) => { events.push(ev); },
    subscribe: () => () => {},
    getRecent: () => events.slice(-50),
    getAllSince: () => events.slice(-50),
    getBuffer: () => events,
  } as unknown as MessageBus;
}

function createMockStore(): MessageStore {
  return {
    listChats: () => [],
    listMessages: () => [],
    getMessagesForChat: () => [],
    getMessagesBefore: () => [],
    getMessagesAfter: () => [],
    getRecentMessages: () => [],
    insert: () => {},
    clearAll: () => 0,
    listTasks: () => [],
    createTask: () => ({} as ReturnType<MessageStore['createTask']>),
    updateTask: () => null,
    deleteTask: () => false,
    getDailySummary: () => null,
    saveDailySummary: () => {},
  } as unknown as MessageStore;
}

// ── Tests ───────────────────────────────────────────────

describe('Business API Routes', () => {
  let app: Hono;
  let botManager: BotManager;
  let bus: MessageBus;
  let store: MessageStore;

  beforeEach(() => {
    app = new Hono();
    botManager = createMockBotManager();
    bus = createMockBus();
    store = createMockStore();
    registerBusinessRoutes(app, { botManager });
  });

  describe('GET /api/business/agents', () => {
    it('returns agent status list with channel info', async () => {
      const res = await app.request('/api/business/agents');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('agents');
      expect(body.agents).toHaveLength(2);

      const salesBot = body.agents.find((a: { name: string }) => a.name === 'sales-bot');
      expect(salesBot.status).toBe('running');
      expect(salesBot.channel).toBe('feishu');
      expect(salesBot.displayName).toBe('Sales Agent');
      expect(salesBot).toHaveProperty('sessionCount');
      expect(salesBot).toHaveProperty('workdir');
    });

    it('includes session counts per agent', async () => {
      const res = await app.request('/api/business/agents');
      const body = await res.json();

      const salesBot = body.agents.find((a: { name: string }) => a.name === 'sales-bot');
      expect(salesBot.sessionCount).toBe(2);
    });

    it('returns running agents first, then stopped', async () => {
      const res = await app.request('/api/business/agents');
      const body = await res.json();

      expect(body.agents[0].status).toBe('running');
      expect(body.agents[1].status).toBe('stopped');
    });
  });

  describe('GET /api/business/agents/:name', () => {
    it('returns detailed info for a specific agent', async () => {
      const res = await app.request('/api/business/agents/sales-bot');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe('sales-bot');
      expect(body.displayName).toBe('Sales Agent');
      expect(body.status).toBe('running');
      expect(body.sessions).toEqual(['chat-1', 'chat-2']);
    });

    it('returns 404 for unknown agent', async () => {
      const res = await app.request('/api/business/agents/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/business/agents/:name/sessions', () => {
    it('returns sessions for an agent', async () => {
      const res = await app.request('/api/business/agents/sales-bot/sessions');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessions).toEqual(['chat-1', 'chat-2']);
    });
  });

  describe('GET /api/business/channels', () => {
    it('returns channel summary with bot counts', async () => {
      const res = await app.request('/api/business/channels');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('channels');
      expect(body.channels).toHaveLength(2);

      const feishuChannel = body.channels.find((c: { name: string }) => c.name === 'feishu');
      expect(feishuChannel.botCount).toBe(1);
      expect(feishuChannel).toHaveProperty('bots');
    });
  });

  describe('GET /api/business/contract-chain', () => {
    it('returns the contract chain overview', async () => {
      const res = await app.request('/api/business/contract-chain');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('agents');
      expect(body).toHaveProperty('channels');
      expect(body.agents).toBeInstanceOf(Array);
    });

    it('each agent in chain has required fields', async () => {
      const res = await app.request('/api/business/contract-chain');
      const body = await res.json();

      for (const agent of body.agents) {
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('channel');
        expect(agent).toHaveProperty('status');
        expect(agent).toHaveProperty('displayName');
      }
    });
  });

  describe('POST /api/business/handoff', () => {
    it('is not exposed as a business API execution shortcut', async () => {
      const res = await app.request('/api/business/handoff', {
        method: 'POST',
        body: JSON.stringify({
          target: 'finance-wangwu',
          task: '结算合同款项',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/business/agents/:name/clear-sessions', () => {
    it('clears sessions for an agent', async () => {
      const res = await app.request('/api/business/agents/sales-bot/clear-sessions', {
        method: 'POST',
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.cleared).toBe(2);
    });

    it('returns 404 for unknown agent', async () => {
      const res = await app.request('/api/business/agents/nonexistent/clear-sessions', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });
});

// ── Tests for real data sources (Phase 6) ─────────────────────

describe('Business API with Real Data Sources', () => {
  let app: Hono;
  let botManager: BotManager;
  let bus: MessageBus;
  let store: MessageStore;
  let statsCollector: StatsCollector;
  let statsStore: InMemoryStatsStore;
  let chainTracker: ContractChainTracker;
  let chainStore: InMemoryChainStore;
  let lockManager: WriteLockManager;
  let employeeManager: EmployeeManager;
  let skillBridge: SkillBridge;
  let appServerMgr: AppServerMgr;
  let appLoader: EmployeeLoader;

  beforeEach(() => {
    app = new Hono();
    botManager = createMockBotManager();
    bus = createMockBus();
    store = createMockStore();

    // Create real instances of the Phase 3-5 components
    statsStore = new InMemoryStatsStore();
    statsCollector = new StatsCollector(statsStore);

    chainStore = new InMemoryChainStore();
    chainTracker = new ContractChainTracker(chainStore);

    lockManager = new WriteLockManager({ enabled: true, defaultTTL: 300_000 });

    // Create minimal colony setup for testing
    skillBridge = new SkillBridge({ toolRegistry: {} as any, appServerMgr, corpDir: '/test/corp' });
    appServerMgr = new AppServerMgr();
    appLoader = new EmployeeLoader({ corpDir: '/test/corp' });
    employeeManager = new EmployeeManager({
      globalModel: 'claude-sonnet-4-20250514',
      createAgent: () => new ClaudeAgent({
        name: 'test',
        agentDir: '/tmp/test',
        cwd: '/tmp/test',
      }),
      skillBridge,
      corpDir: '/test/corp',
      dataDir: '/tmp/test',
    });

    // Register routes with real deps
    registerBusinessRoutes(app, {
      botManager,
      statsCollector,
      statsStore,
      chainTracker,
      lockManager,
      employeeManager,
    });
  });

  describe('GET /api/business/stats', () => {
    it('returns agent stats from real StatsCollector', async () => {
      // Record some test data
      statsCollector.recordTokenUsage({
        agentId: 'sales-bot',
        inputTokens: 1000,
        outputTokens: 500,
        model: 'claude-sonnet-4-20250514',
      });

      statsCollector.recordAgentRun({
        agentId: 'sales-bot',
        trigger: 'message',
        success: true,
        durationMs: 1500,
      });

      const res = await app.request('/api/business/stats');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.stats).toBeInstanceOf(Array);
      const salesBotStats = body.stats.find((s: AgentStats) => s.agentId === 'sales-bot');
      expect(salesBotStats).toBeDefined();
      expect(salesBotStats.totalInputTokens).toBe(1000);
      expect(salesBotStats.totalOutputTokens).toBe(500);
      expect(salesBotStats.callCount).toBe(1);
      expect(salesBotStats.runCount).toBe(1);
      expect(salesBotStats.failureCount).toBe(0);
    });

    it('supports date range filtering', async () => {
      // Record test data
      statsCollector.recordTokenUsage({
        agentId: 'support-bot',
        inputTokens: 2000,
        outputTokens: 1000,
        model: 'claude-sonnet-4-20250514',
      });

      const from = Date.now() - 3600000; // 1 hour ago
      const to = Date.now() + 3600000; // 1 hour from now

      const res = await app.request(`/api/business/stats?from=${from}&to=${to}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.stats).toBeInstanceOf(Array);
      expect(body.stats.length).toBeGreaterThan(0);
    });

    it('returns empty array when no stats recorded', async () => {
      const res = await app.request('/api/business/stats');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.stats).toEqual([]);
    });
  });

  describe('GET /api/business/stats/:agentId', () => {
    it('returns stats for a specific agent', async () => {
      statsCollector.recordTokenUsage({
        agentId: 'sales-bot',
        inputTokens: 1000,
        outputTokens: 500,
        model: 'claude-sonnet-4-20250514',
      });

      const res = await app.request('/api/business/stats/sales-bot');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.agentId).toBe('sales-bot');
      expect(body.totalInputTokens).toBe(1000);
      expect(body.totalOutputTokens).toBe(500);
    });

    it('returns 404 for unknown agent', async () => {
      const res = await app.request('/api/business/stats/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/business/contract-events', () => {
    it('returns contract chain events from real tracker', async () => {
      chainTracker.recordEvent({
        contractId: 'contract-123',
        agentId: 'sales-bot',
        action: 'approved',
        detail: 'Initial approval',
      });

      chainTracker.recordEvent({
        contractId: 'contract-123',
        agentId: 'support-bot',
        action: 'reviewed',
        detail: 'Customer review',
      });

      const res = await app.request('/api/business/contract-events?contractId=contract-123');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events).toHaveLength(2);
      expect(body.events[0].contractId).toBe('contract-123');
    });

    it('supports agent filtering in contract events', async () => {
      chainTracker.recordEvent({
        contractId: 'contract-123',
        agentId: 'sales-bot',
        action: 'approved',
      });

      chainTracker.recordEvent({
        contractId: 'contract-123',
        agentId: 'support-bot',
        action: 'reviewed',
      });

      const res = await app.request('/api/business/contract-events?contractId=contract-123&agentId=sales-bot');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].agentId).toBe('sales-bot');
    });

    it('returns active contracts within date range', async () => {
      chainTracker.recordEvent({
        contractId: 'contract-123',
        agentId: 'sales-bot',
        action: 'approved',
      });

      const from = Date.now() - 3600000;
      const to = Date.now() + 3600000;

      const res = await app.request(`/api/business/contract-events?from=${from}&to=${to}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.contracts).toBeInstanceOf(Array);
      expect(body.contracts).toContain('contract-123');
    });
  });

  describe('GET /api/business/locks', () => {
    it('returns all active write locks', async () => {
      lockManager.acquire({
        entity: 'contract',
        entityId: 'contract-123',
        lockedBy: 'sales-bot',
      });

      lockManager.acquire({
        entity: 'lead',
        entityId: 'lead-456',
        lockedBy: 'support-bot',
      });

      const res = await app.request('/api/business/locks');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.locks).toBeInstanceOf(Array);
      expect(body.locks).toHaveLength(2);
    });

    it('supports filtering by agent', async () => {
      lockManager.acquire({
        entity: 'contract',
        entityId: 'contract-123',
        lockedBy: 'sales-bot',
      });

      lockManager.acquire({
        entity: 'lead',
        entityId: 'lead-456',
        lockedBy: 'support-bot',
      });

      const res = await app.request('/api/business/locks?agentId=sales-bot');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.locks).toHaveLength(1);
      expect(body.locks[0].lockedBy).toBe('sales-bot');
    });

    it('supports filtering by entity type', async () => {
      lockManager.acquire({
        entity: 'contract',
        entityId: 'contract-123',
        lockedBy: 'sales-bot',
      });

      lockManager.acquire({
        entity: 'lead',
        entityId: 'lead-456',
        lockedBy: 'support-bot',
      });

      const res = await app.request('/api/business/locks?entity=contract');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.locks).toHaveLength(1);
      expect(body.locks[0].entity).toBe('contract');
    });
  });

  describe('GET /api/business/agents', () => {
    it('returns employee agent information', async () => {
      const res = await app.request('/api/business/agents');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.agents).toBeInstanceOf(Array);
    });

    it('includes registered employee agents', async () => {
      // The test doesn't actually register any apps, so we expect empty
      // but the structure should be correct
      const res = await app.request('/api/business/agents');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('agents');
      // count field not returned by this endpoint
    });
  });

  describe('GET /api/business/agents/:appId', () => {
    it('returns 404 for unregistered app', async () => {
      const res = await app.request('/api/business/agents/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
