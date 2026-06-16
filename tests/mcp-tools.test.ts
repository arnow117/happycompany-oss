import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlatformToolDefs, buildPlatformMcpServer, type McpToolsContext } from '../src/mcp-tools.js';
import { MemoryManager } from '../src/memory.js';
import { existsSync, rmSync, mkdirSync } from 'node:fs';

const TEST_DIR = '/tmp/happycompany-test-mcp-tools';

// Minimal mock for TaskScheduler public surface
function createMockScheduler() {
  const tasks: Array<{
    id: string;
    name: string;
    botName: string;
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    enabled: boolean;
  }> = [];

  return {
    listTasks: vi.fn(() => tasks),
    createTask: vi.fn((input: { name: string; botName: string; scheduleType: string; scheduleValue: string; prompt: string }) => {
      const task = { id: `t-${tasks.length + 1}`, ...input, enabled: true };
      tasks.push(task);
      return task;
    }),
    deleteTask: vi.fn((id: string) => {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      tasks.splice(idx, 1);
      return true;
    }),
    // Internal state for assertions
    _tasks: tasks,
  };
}

function createMockMemory() {
  return {
    appendMemory: vi.fn(),
    searchMemory: vi.fn(() => []),
  };
}

/** Helper: find a tool definition by name and return its handler. */
function getToolHandler(tools: ReturnType<typeof buildPlatformToolDefs>, name: string) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t.handler;
}

/** Extract text from a CallToolResult. */
function getResultText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content[0]!.text;
}

describe('buildPlatformToolDefs', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    memoryManager = new MemoryManager(TEST_DIR);
  });

  it('returns 9 tool definitions', () => {
    const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager };
    const tools = buildPlatformToolDefs(ctx);
    expect(tools).toHaveLength(9);

    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'send_message',
      'schedule_task',
      'list_tasks',
      'cancel_task',
      'memory_append',
      'memory_search',
      'get_inbox',
      'list_inbox',
      'handoff',
    ]);
  });

  it('each tool has name, description, inputSchema, and handler', () => {
    const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager };
    const tools = buildPlatformToolDefs(ctx);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.handler).toBe('function');
    }
  });

  // ── send_message ────────────────────────────────────────

  describe('send_message', () => {
    it('returns a confirmation with the text', async () => {
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'send_message');

      const result = await handler({ text: 'Hello world' }, undefined);
      expect(getResultText(result)).toContain('Hello world');
      expect(getResultText(result)).toContain('Message sent');
    });
  });

  // ── schedule_task ───────────────────────────────────────

  describe('schedule_task', () => {
    it('creates a task when scheduler is available', async () => {
      const scheduler = createMockScheduler();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'schedule_task');

      const result = await handler({ prompt: 'Run this', schedule_type: 'cron', schedule_value: '0 * * * *' }, undefined);
      expect(getResultText(result)).toContain('Task created with ID');
      expect(scheduler.createTask).toHaveBeenCalledOnce();
    });

    it('returns error when scheduler is not available', async () => {
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'schedule_task');

      const result = await handler({ schedule_type: 'cron', schedule_value: '0 * * * *' }, undefined);
      expect(getResultText(result)).toContain('Scheduler not available');
    });
  });

  // ── list_tasks ──────────────────────────────────────────

  describe('list_tasks', () => {
    it('returns formatted list of tasks', async () => {
      const scheduler = createMockScheduler();
      scheduler._tasks.push({
        id: 't-1',
        name: 'daily-report',
        botName: 'test-bot',
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        prompt: 'Generate daily report',
        enabled: true,
      });
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'list_tasks');

      const result = await handler({}, undefined);
      const text = getResultText(result);
      expect(text).toContain('[t-1]');
      expect(text).toContain('daily-report');
      expect(text).toContain('enabled');
    });

    it('returns no tasks message when empty', async () => {
      const scheduler = createMockScheduler();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'list_tasks');

      const result = await handler({}, undefined);
      expect(getResultText(result)).toContain('No tasks found');
    });

    it('filters tasks by botName', async () => {
      const scheduler = createMockScheduler();
      scheduler._tasks.push({
        id: 't-1',
        name: 'other-task',
        botName: 'other-bot',
        scheduleType: 'cron',
        scheduleValue: '0 * * * *',
        prompt: 'Other',
        enabled: true,
      });
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'list_tasks');

      const result = await handler({}, undefined);
      expect(getResultText(result)).toContain('No tasks found');
    });
  });

  // ── cancel_task ─────────────────────────────────────────

  describe('cancel_task', () => {
    it('cancels an existing task', async () => {
      const scheduler = createMockScheduler();
      scheduler._tasks.push({
        id: 't-1',
        name: 'task',
        botName: 'test-bot',
        scheduleType: 'cron',
        scheduleValue: '0 * * * *',
        prompt: 'X',
        enabled: true,
      });
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'cancel_task');

      const result = await handler({ task_id: 't-1' }, undefined);
      expect(getResultText(result)).toContain('cancelled');
      expect(scheduler.deleteTask).toHaveBeenCalledWith('t-1');
    });

    it('returns error when task not found', async () => {
      const scheduler = createMockScheduler();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager, scheduler: scheduler as unknown as McpToolsContext['scheduler'] };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'cancel_task');

      const result = await handler({ task_id: 'nonexistent' }, undefined);
      expect(getResultText(result)).toContain('not found');
    });
  });

  // ── memory_append ───────────────────────────────────────

  describe('memory_append', () => {
    it('appends content to memory', async () => {
      const mockMemory = createMockMemory();
      const memoryOps: Array<{
        operation: 'append' | 'search' | 'read' | 'write';
        subject: string;
        status?: 'ok' | 'error';
      }> = [];
      const ctx: McpToolsContext = {
        botName: 'test-bot',
        memory: mockMemory as unknown as MemoryManager,
        onMemoryOp: (info) => memoryOps.push(info),
      };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_append');

      const result = await handler({ content: 'Decision: use PostgreSQL', date: '2026-05-03' }, undefined);
      expect(getResultText(result)).toContain('Memory appended');
      expect(mockMemory.appendMemory).toHaveBeenCalledWith('test-bot', 'Decision: use PostgreSQL', '2026-05-03');
      expect(memoryOps).toEqual([
        { operation: 'append', subject: 'test-bot', status: 'ok' },
      ]);
    });

    it('appends to today when date omitted', async () => {
      const mockMemory = createMockMemory();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: mockMemory as unknown as MemoryManager };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_append');

      const result = await handler({ content: 'Some note' }, undefined);
      expect(getResultText(result)).toContain('Memory appended');
      expect(mockMemory.appendMemory).toHaveBeenCalledWith('test-bot', 'Some note', undefined);
    });

    it('returns error on failure', async () => {
      const mockMemory = createMockMemory();
      mockMemory.appendMemory.mockImplementation(() => {
        throw new Error('Content too large');
      });
      const memoryOps: Array<{
        operation: 'append' | 'search' | 'read' | 'write';
        subject: string;
        status?: 'ok' | 'error';
      }> = [];
      const ctx: McpToolsContext = {
        botName: 'test-bot',
        memory: mockMemory as unknown as MemoryManager,
        onMemoryOp: (info) => memoryOps.push(info),
      };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_append');

      const result = await handler({ content: 'x'.repeat(20000) }, undefined);
      const text = getResultText(result);
      expect(text).toContain('Memory append failed');
      expect(text).toContain('Content too large');
      expect(memoryOps).toEqual([
        { operation: 'append', subject: 'test-bot', status: 'error' },
      ]);
    });
  });

  // ── memory_search ───────────────────────────────────────

  describe('memory_search', () => {
    it('returns formatted results', async () => {
      const mockMemory = createMockMemory();
      mockMemory.searchMemory.mockReturnValue([
        { file: '2026-05-03.md', line: 5, context: 'Decision: use PostgreSQL for persistence' },
      ]);
      const memoryOps: Array<{
        operation: 'append' | 'search' | 'read' | 'write';
        subject: string;
        status?: 'ok' | 'error';
      }> = [];
      const ctx: McpToolsContext = {
        botName: 'test-bot',
        memory: mockMemory as unknown as MemoryManager,
        onMemoryOp: (info) => memoryOps.push(info),
      };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_search');

      const result = await handler({ query: 'PostgreSQL' }, undefined);
      const text = getResultText(result);
      expect(text).toContain('2026-05-03.md');
      expect(text).toContain('PostgreSQL');
      expect(mockMemory.searchMemory).toHaveBeenCalledWith('test-bot', 'PostgreSQL', undefined);
      expect(memoryOps).toEqual([
        { operation: 'search', subject: 'test-bot', status: 'ok' },
      ]);
    });

    it('returns no results message when empty', async () => {
      const mockMemory = createMockMemory();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: mockMemory as unknown as MemoryManager };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_search');

      const result = await handler({ query: 'nonexistent' }, undefined);
      expect(getResultText(result)).toContain('No results found');
    });

    it('passes max_results parameter', async () => {
      const mockMemory = createMockMemory();
      const ctx: McpToolsContext = { botName: 'test-bot', memory: mockMemory as unknown as MemoryManager };
      const handler = getToolHandler(buildPlatformToolDefs(ctx), 'memory_search');

      await handler({ query: 'test', max_results: 5 }, undefined);
      expect(mockMemory.searchMemory).toHaveBeenCalledWith('test-bot', 'test', 5);
    });
  });
});

// ── buildPlatformMcpServer integration ──────────────────

describe('buildPlatformMcpServer', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    memoryManager = new MemoryManager(TEST_DIR);
  });

  it('returns an MCP server config with instance', () => {
    const ctx: McpToolsContext = { botName: 'test-bot', memory: memoryManager };
    const server = buildPlatformMcpServer(ctx);
    expect(server).toBeDefined();
    expect(server.instance).toBeDefined();
  });
});
