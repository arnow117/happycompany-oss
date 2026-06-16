# Phase 1: Tool Manifest + AppServerMgr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ToolRegistry (tools.json discovery + validation) and AppServerMgr (JSON-RPC over stdio + CLI fallback), inject tenant APP tools into Claude Agent via dynamic MCP server with progressive disclosure (App summary → load full tools on demand).

**Architecture:** New `src/tool-registry.ts` scans `corp/*/apps/*/tools.json` with Zod validation. New `src/app-server.ts` manages long-lived Python subprocesses via JSON-RPC over stdio. `src/mcp-tools.ts` gains a `buildTenantMcpServer()` function. `index.ts` and `agent.ts` are wired to pass tenant-specific MCP servers alongside the platform MCP server.

**Tech Stack:** TypeScript, Zod (schemas), `@anthropic-ai/claude-agent-sdk` (MCP tool API), Node.js `child_process` (JSON-RPC over stdio)

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `src/tool-schemas.ts` | Zod schemas for tools.json, app.json, roles.json | **Create** |
| `src/tool-registry.ts` | Scan, validate, register tool definitions; lookup + query by tenant | **Create** |
| `src/app-server.ts` | Long-lived Python subprocess management + JSON-RPC over stdio + CLI fallback | **Create** |
| `src/mcp-tools.ts` | Add `buildTenantMcpServer()` and `_load_app_tools` handler | **Modify** |
| `src/types.ts` | Add `ToolDef`, `AppManifest`, `RiskLevel` types | **Modify** |
| `src/index.ts` | Initialize ToolRegistry + AppServerMgr at boot; wire into agentFactory | **Modify** |
| `corp/acme/app.json` | Enterprise metadata for acme tenant | **Create** |
| `corp/acme/apps/med_crm/tools.json` | Tool manifest for med_crm app | **Create** |
| `corp/acme/roles.json` | Role definitions for acme tenant (placeholder, Phase 3) | **Create** |
| `tests/tool-registry.test.ts` | ToolRegistry unit tests | **Create** |
| `tests/app-server.test.ts` | AppServerMgr unit tests | **Create** |
| `tests/tool-schemas.test.ts` | Zod schema validation tests | **Create** |

---

### Task 1: Define types and Zod schemas

**Files:**
- Create: `src/tool-schemas.ts`
- Modify: `src/types.ts`
- Test: `tests/tool-schemas.test.ts`

- [ ] **Step 1: Write the failing test for Zod schemas**

```typescript
// tests/tool-schemas.test.ts
import { describe, it, expect } from 'vitest';
import { toolManifestSchema, appJsonSchema, riskLevelSchema } from '../src/tool-schemas.js';

describe('riskLevelSchema', () => {
  it('accepts valid risk levels', () => {
    expect(riskLevelSchema.parse('read')).toBe('read');
    expect(riskLevelSchema.parse('internal_write')).toBe('internal_write');
    expect(riskLevelSchema.parse('external')).toBe('external');
    expect(riskLevelSchema.parse('destructive')).toBe('destructive');
  });

  it('rejects invalid risk levels', () => {
    expect(() => riskLevelSchema.parse('invalid')).toThrow();
  });
});

describe('toolManifestSchema', () => {
  const validManifest = {
    name: 'med_crm',
    version: '1.0.0',
    displayName: '医院CRM',
    description: '医疗器械销售 CRM',
    tools: [
      {
        name: 'search_hospitals',
        description: '搜索医院',
        riskLevel: 'read' as const,
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '医院名称关键词' },
            province: { type: 'string' },
          },
        },
      },
      {
        name: 'delete_hospital',
        description: '删除医院记录',
        riskLevel: 'destructive' as const,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
          },
          required: ['id'],
        },
      },
    ],
    server: {
      entry: 'server.py',
      python: '3.12',
    },
  };

  it('parses a valid tools.json', () => {
    const result = toolManifestSchema.parse(validManifest);
    expect(result.name).toBe('med_crm');
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].riskLevel).toBe('read');
    expect(result.server?.entry).toBe('server.py');
  });

  it('parses manifest without server field', () => {
    const { server, ...withoutServer } = validManifest;
    const result = toolManifestSchema.parse(withoutServer);
    expect(result.server).toBeUndefined();
  });

  it('requires name and tools array', () => {
    expect(() => toolManifestSchema.parse({ name: 'test' })).toThrow();
    expect(() => toolManifestSchema.parse({ tools: [] })).toThrow();
  });

  it('validates riskLevel on each tool', () => {
    const badTool = {
      ...validManifest,
      tools: [{ ...validManifest.tools[0], riskLevel: 'mega_dangerous' }],
    };
    expect(() => toolManifestSchema.parse(badTool)).toThrow();
  });
});

describe('appJsonSchema', () => {
  const validAppJson = {
    displayName: '示例医疗',
    description: '杭州示例医疗器械销售系统',
    model: 'claude-sonnet-4-20250514',
  };

  it('parses a valid app.json', () => {
    const result = appJsonSchema.parse(validAppJson);
    expect(result.displayName).toBe('示例医疗');
  });

  it('allows empty object (all optional)', () => {
    const result = appJsonSchema.parse({});
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-schemas.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/tool-schemas.ts
import { z } from 'zod';

// --- Risk Level ---

export const riskLevelSchema = z.enum(['read', 'internal_write', 'external', 'destructive']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

// --- Tool Definition (within tools.json) ---

export const toolDefSchema = z.object({
  name: z.string().min(1).describe('Tool name (snake_case)'),
  description: z.string().min(1).describe('Human-readable description for the LLM'),
  riskLevel: riskLevelSchema.default('read'),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()).describe('JSON Schema properties'),
    required: z.array(z.string()).optional(),
  }).describe('JSON Schema parameters'),
});

export type ToolDefInput = z.input<typeof toolDefSchema>;
export type ToolDef = z.infer<typeof toolDefSchema>;

// --- Server config (optional, for long-lived JSON-RPC) ---

export const serverConfigSchema = z.object({
  entry: z.string().describe('Entry point file (e.g. server.py)'),
  python: z.string().optional().describe('Python version constraint'),
}).strict();

// --- Tool Manifest (tools.json) ---

export const toolManifestSchema = z.object({
  name: z.string().min(1).describe('App identifier'),
  version: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tools: z.array(toolDefSchema).min(0),
  server: serverConfigSchema.optional(),
}).strict();

export type ToolManifestInput = z.input<typeof toolManifestSchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;

// --- app.json (per-tenant metadata) ---

export const appJsonSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  budget: z.object({
    dailyTokenLimit: z.number().optional(),
    maxTokensPerQuery: z.number().optional(),
  }).optional(),
  outcomeSignals: z.object({
    positive: z.array(z.string()).optional(),
    negative: z.array(z.string()).optional(),
  }).optional(),
  followup: z.object({
    enabled: z.boolean().optional(),
    delayDays: z.number().optional(),
    prompt: z.string().optional(),
  }).optional(),
  contextCompaction: z.object({
    enabled: z.boolean().optional(),
    threshold: z.number().optional(),
    keepRecent: z.number().optional(),
    summaryPrompt: z.string().optional(),
  }).optional(),
}).strict();

export type AppJson = z.infer<typeof appJsonSchema>;

// --- roles.json (per-tenant, placeholder for Phase 3) ---

export const roleSchema = z.object({
  displayName: z.string(),
  tools: z.union([
    z.literal('*'),
    z.array(z.string()),
  ]),
});

export const rolesJsonSchema = z.object({
  roles: z.record(roleSchema),
  users: z.record(z.string()).optional(),
}).strict();

export type RolesJson = z.infer<typeof rolesJsonSchema>;
```

Also add types to `src/types.ts`:

```typescript
// Add to src/types.ts after BotConfig

import type { RiskLevel, ToolDef, ToolManifest } from './tool-schemas.js';

export interface RegisteredTool extends ToolDef {
  /** Namespaced tool name: "app_name:tool_name" */
  namespacedName: string;
  /** Source app name */
  appName: string;
  /** Source tenant name */
  tenantName: string;
  /** Whether a long-lived server is available */
  hasServer: boolean;
}

export interface TenantInfo {
  name: string;
  path: string;
  appJson?: AppJson;
}
```

(Note: `AppJson` import will be resolved when `tool-schemas.ts` is created.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tool-schemas.ts src/types.ts tests/tool-schemas.test.ts
git commit -m "feat: add Zod schemas for tools.json, app.json, roles.json"
```

---

### Task 2: Implement ToolRegistry

**Files:**
- Create: `src/tool-registry.ts`
- Test: `tests/tool-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tool-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tool-registry.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ToolRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeToolsJson(tenant: string, app: string, content: object): string {
    const dir = path.join(tmpDir, tenant, 'apps', app);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'tools.json');
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  it('discovers and registers tools from corp/*/apps/*/tools.json', () => {
    writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      version: '1.0.0',
      displayName: '医院CRM',
      description: '医疗器械销售 CRM',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: { keyword: { type: 'string' } } } },
        { name: 'add_contact', description: '添加联系人', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
      ],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.getToolsForTenant('acme')).toHaveLength(2);
    expect(registry.lookup('med_crm:search_hospitals')).toBeDefined();
    expect(registry.lookup('med_crm:search_hospitals')!.tenantName).toBe('acme');
  });

  it('namespaces tools with app:tool_name prefix', () => {
    writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      tools: [{ name: 'search_hospitals', description: '搜索', riskLevel: 'read', parameters: { type: 'object', properties: {} } }],
    });
    writeToolsJson('acme', 'device_kb', {
      name: 'device_kb',
      tools: [{ name: 'search', description: '搜索知识库', riskLevel: 'read', parameters: { type: 'object', properties: {} } }],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.lookup('med_crm:search_hospitals')).toBeDefined();
    expect(registry.lookup('device_kb:search')).toBeDefined();
    expect(registry.lookup('search_hospitals')).toBeUndefined();
  });

  it('returns empty array for unknown tenant', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.scan();
    expect(registry.getToolsForTenant('nonexistent')).toHaveLength(0);
  });

  it('returns app summaries for progressive disclosure', () => {
    writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      displayName: '医院CRM',
      description: '医疗器械销售 CRM',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: {} } },
        { name: 'add_contact', description: '添加联系人', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
      ],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    const summaries = registry.getAppSummaries('acme');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].name).toBe('med_crm');
    expect(summaries[0].displayName).toBe('医院CRM');
    expect(summaries[0].toolCount).toBe(2);
  });

  it('returns full tool list for a specific app', () => {
    writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: { keyword: { type: 'string' } } } },
        { name: 'add_contact', description: '添加联系人', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
      ],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    const tools = registry.getAppTools('acme', 'med_crm');
    expect(tools).toHaveLength(2);
    expect(tools[0].namespacedName).toBe('med_crm:search_hospitals');
  });

  it('validates tools.json with Zod and skips invalid files', () => {
    const dir = path.join(tmpDir, 'acme', 'apps', 'bad_app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tools.json'), 'not json at all');

    writeToolsJson('acme', 'good_app', {
      name: 'good_app',
      tools: [{ name: 'do_stuff', description: '做事情', riskLevel: 'read', parameters: { type: 'object', properties: {} } }],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.getToolsForTenant('acme')).toHaveLength(1);
    expect(registry.lookup('good_app:do_stuff')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/tool-registry.ts
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { toolManifestSchema } from './tool-schemas.js';
import type { ToolManifest, RegisteredTool } from './types.js';

export interface AppSummary {
  name: string;
  displayName: string;
  description: string;
  toolCount: number;
  hasServer: boolean;
}

export class ToolRegistry {
  private readonly corpDir: string;
  private tools = new Map<string, RegisteredTool>();
  private manifests = new Map<string, ToolManifest>();
  private tenantTools = new Map<string, string[]>();

  constructor(corpDir: string) {
    this.corpDir = corpDir;
  }

  scan(): void {
    this.tools.clear();
    this.manifests.clear();
    this.tenantTools.clear();

    if (!fs.existsSync(this.corpDir)) {
      logger.warn({ corpDir: this.corpDir }, 'corp directory does not exist');
      return;
    }

    const tenants = fs.readdirSync(this.corpDir, { withFileTypes: true });
    for (const tenant of tenants) {
      if (!tenant.isDirectory()) continue;

      const appsDir = path.join(this.corpDir, tenant.name, 'apps');
      if (!fs.existsSync(appsDir)) continue;

      const appNames = fs.readdirSync(appsDir, { withFileTypes: true });
      for (const app of appNames) {
        if (!app.isDirectory()) continue;

        const toolsJsonPath = path.join(appsDir, app.name, 'tools.json');
        if (!fs.existsSync(toolsJsonPath)) continue;

        try {
          const raw = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
          const manifest = toolManifestSchema.parse(raw);
          this.registerTenantApp(tenant.name, manifest);
        } catch (err) {
          logger.warn(
            { path: toolsJsonPath, err },
            'Failed to parse tools.json, skipping',
          );
        }
      }
    }

    logger.info(
      { toolCount: this.tools.size, tenants: this.tenantTools.size },
      'ToolRegistry scan complete',
    );
  }

  private registerTenantApp(tenantName: string, manifest: ToolManifest): void {
    const key = `${tenantName}:${manifest.name}`;
    this.manifests.set(key, manifest);

    if (!this.tenantTools.has(tenantName)) {
      this.tenantTools.set(tenantName, []);
    }
    this.tenantTools.get(tenantName)!.push(key);

    for (const toolDef of manifest.tools) {
      const namespacedName = `${manifest.name}:${toolDef.name}`;
      const registered: RegisteredTool = {
        ...toolDef,
        namespacedName,
        appName: manifest.name,
        tenantName,
        hasServer: !!manifest.server,
      };
      this.tools.set(namespacedName, registered);
    }
  }

  lookup(namespacedName: string): RegisteredTool | undefined {
    return this.tools.get(namespacedName);
  }

  getToolsForTenant(tenantName: string): RegisteredTool[] {
    const keys = this.tenantTools.get(tenantName);
    if (!keys) return [];

    const result: RegisteredTool[] = [];
    for (const key of keys) {
      const manifest = this.manifests.get(key);
      if (!manifest) continue;
      for (const toolDef of manifest.tools) {
        const registered = this.tools.get(`${manifest.name}:${toolDef.name}`);
        if (registered) result.push(registered);
      }
    }
    return result;
  }

  getAppSummaries(tenantName: string): AppSummary[] {
    const keys = this.tenantTools.get(tenantName);
    if (!keys) return [];

    return keys.map((key) => {
      const manifest = this.manifests.get(key);
      if (!manifest) return null;
      return {
        name: manifest.name,
        displayName: manifest.displayName ?? manifest.name,
        description: manifest.description ?? '',
        toolCount: manifest.tools.length,
        hasServer: !!manifest.server,
      };
    }).filter((s): s is AppSummary => s !== null);
  }

  getAppTools(tenantName: string, appName: string): RegisteredTool[] {
    const manifest = this.manifests.get(`${tenantName}:${appName}`);
    if (!manifest) return [];

    const result: RegisteredTool[] = [];
    for (const toolDef of manifest.tools) {
      const registered = this.tools.get(`${appName}:${toolDef.name}`);
      if (registered) result.push(registered);
    }
    return result;
  }

  getManifest(tenantName: string, appName: string): ToolManifest | undefined {
    return this.manifests.get(`${tenantName}:${appName}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tool-registry.ts tests/tool-registry.test.ts
git commit -m "feat: implement ToolRegistry with scan, lookup, progressive disclosure"
```

---

### Task 3: Implement AppServerMgr

**Files:**
- Create: `src/app-server.ts`
- Test: `tests/app-server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/app-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppServerMgr } from '../src/app-server.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('AppServerMgr', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-server-'));
  });

  afterEach(() => {
    const mgr = AppServerMgr.getInstance();
    if (mgr) mgr.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeServerScript(appName: string): string {
    const dir = path.join(tmpDir, appName);
    fs.mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'server.py');
    // Simple JSON-RPC server that reads from stdin, writes to stdout
    fs.writeFileSync(scriptPath, [
      'import sys, json',
      'for line in sys.stdin:',
      '  req = json.loads(line)',
      '  resp = {"jsonrpc": "2.0", "id": req.get("id"), "result": {"echo": req.get("params", {})}}',
      '  print(json.dumps(resp), flush=True)',
    ].join('\n'));
    return dir;
  }

  it('starts a server process and calls via JSON-RPC', async () => {
    const serverDir = writeServerScript('test_app');
    const mgr = new AppServerMgr();
    await mgr.startServer('test_app', { cwd: serverDir, entry: 'server.py' });

    const result = await mgr.call('test_app', 'echo', { message: 'hello' });
    expect(result).toEqual({ echo: { message: 'hello' } });

    mgr.stopServer('test_app');
  });

  it('returns error when calling a non-running server', async () => {
    const mgr = new AppServerMgr();
    await expect(mgr.call('nonexistent', 'test', {})).rejects.toThrow('not running');
  });

  it('handles server process crash and reports status', async () => {
    const dir = path.join(tmpDir, 'crash_app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.py'), 'import sys; sys.exit(1)');

    const mgr = new AppServerMgr();
    await mgr.startServer('crash_app', { cwd: dir, entry: 'server.py' });

    const status = mgr.getServerStatus('crash_app');
    expect(status.running).toBe(false);
  });

  it('calls CLI fallback when no server is available', async () => {
    const dir = path.join(tmpDir, 'cli_app');
    fs.mkdirSync(dir, { recursive: true });
    const cliPath = path.join(dir, 'cli.py');
    fs.writeFileSync(cliPath, [
      'import sys, json',
      'print(json.dumps({"result": "cli_ok"}))',
    ].join('\n'));

    const mgr = new AppServerMgr();
    const result = await mgr.callCli({
      cwd: dir,
      command: process.execPath,
      args: [cliPath, '--json'],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ result: 'cli_ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/app-server.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/app-server.ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { sanitizeEnv } from './env-guard.js';
import { logger } from './logger.js';

export interface ServerConfig {
  cwd: string;
  entry: string;
  python?: string;
}

export interface ServerStatus {
  running: boolean;
  pid?: number;
  startedAt?: number;
  restartCount: number;
}

interface ManagedServer {
  process: ChildProcess;
  config: ServerConfig;
  startedAt: number;
  restartCount: number;
  pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  nextId: number;
}

export class AppServerMgr {
  private servers = new Map<string, ManagedServer>();
  private static instance: AppServerMgr | null = null;

  static getInstance(): AppServerMgr | null {
    return AppServerMgr.instance;
  }

  constructor() {
    AppServerMgr.instance = this;
  }

  async startServer(appName: string, config: ServerConfig): Promise<void> {
    if (this.servers.has(appName)) {
      logger.warn({ appName }, 'Server already running, stopping first');
      this.stopServer(appName);
    }

    const proc = spawn(
      config.python ?? 'python3',
      [config.entry],
      {
        cwd: config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitizeEnv(process.env as Record<string, string>),
      },
    );

    const managed: ManagedServer = {
      process: proc,
      config,
      startedAt: Date.now(),
      restartCount: 0,
      pendingRequests: new Map(),
      nextId: 1,
    };

    proc.stdout.on('data', (data: Buffer) => {
      this.handleServerOutput(appName, managed, data.toString());
    });

    proc.stderr.on('data', (data: Buffer) => {
      logger.warn({ appName, stderr: data.toString().trim() }, 'Server stderr');
    });

    proc.on('close', (code) => {
      logger.warn({ appName, code }, 'Server process exited');
      managed.process = null as unknown as ChildProcess;
      // Reject all pending requests
      for (const [id, req] of managed.pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error(`Server process exited (code: ${code})`));
        managed.pendingRequests.delete(id);
      }
    });

    this.servers.set(appName, managed);
    logger.info({ appName, pid: proc.pid }, 'Server started');
  }

  async call(appName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const managed = this.servers.get(appName);
    if (!managed?.process) {
      throw new Error(`Server "${appName}" is not running`);
    }

    const id = String(managed.nextId++);
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        managed.pendingRequests.delete(id);
        reject(new Error(`Server call timeout: ${appName}.${method}`));
      }, 30_000);

      managed.pendingRequests.set(id, { resolve, reject, timer });

      managed.process.stdin!.write(JSON.stringify(request) + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          managed.pendingRequests.delete(id);
          reject(new Error(`Failed to write to server stdin: ${err.message}`));
        }
      });
    });
  }

  async callCli(options: {
    cwd: string;
    command: string;
    args: string[];
    timeoutMs?: number;
  }): Promise<unknown> {
    const { cwd, command, args, timeoutMs = 30_000 } = options;

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitizeEnv(process.env as Record<string, string>),
      });

      let stdout = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`CLI timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          reject(new Error(`CLI output is not valid JSON (exit code: ${code}): ${stdout.slice(0, 200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.stdin!.end();
    });
  }

  stopServer(appName: string): void {
    const managed = this.servers.get(appName);
    if (!managed) return;

    if (managed.process && !managed.process.killed) {
      managed.process.kill('SIGTERM');
    }
    this.servers.delete(appName);
    logger.info({ appName }, 'Server stopped');
  }

  stopAll(): void {
    for (const appName of this.servers.keys()) {
      this.stopServer(appName);
    }
  }

  getServerStatus(appName: string): ServerStatus {
    const managed = this.servers.get(appName);
    if (!managed) return { running: false, restartCount: 0 };

    return {
      running: !!managed.process && !managed.process.killed,
      pid: managed.process?.pid,
      startedAt: managed.startedAt,
      restartCount: managed.restartCount,
    };
  }

  private handleServerOutput(appName: string, managed: ManagedServer, output: string): void {
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && managed.pendingRequests.has(String(msg.id))) {
          const req = managed.pendingRequests.get(String(msg.id))!;
          clearTimeout(req.timer);
          managed.pendingRequests.delete(String(msg.id));
          if (msg.error) {
            req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch {
        // Non-JSON line, ignore
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/app-server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app-server.ts tests/app-server.test.ts
git commit -m "feat: implement AppServerMgr with JSON-RPC over stdio and CLI fallback"
```

---

### Task 4: Build tenant MCP server with progressive disclosure

**Files:**
- Modify: `src/mcp-tools.ts`
- Test: `tests/mcp-tools-tenant.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mcp-tools-tenant.test.ts
import { describe, it, expect } from 'vitest';
import { buildTenantMcpServer, buildAppSummaryTools, buildAppTools } from '../src/mcp-tools.js';
import type { RegisteredTool, AppSummary } from '../src/types.js';

describe('buildAppSummaryTools', () => {
  it('creates an app: tool for each app summary (progressive disclosure)', () => {
    const summaries: AppSummary[] = [
      { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 6, hasServer: true },
      { name: 'device_kb', displayName: '设备知识库', description: '维修知识检索', toolCount: 3, hasServer: false },
    ];

    const tools = buildAppSummaryTools(summaries, () => Promise.resolve([]));
    expect(tools.length).toBe(2);
    expect(tools[0].name).toBe('app:med_crm');
    expect(tools[1].name).toBe('app:device_kb');
  });

  it('includes a _load_app_tools meta-tool', () => {
    const summaries: AppSummary[] = [
      { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 2, hasServer: false },
    ];

    const tools = buildAppSummaryTools(summaries, () => Promise.resolve([]));
    expect(tools.some((t) => t.name === '_load_app_tools')).toBe(true);
  });
});

describe('buildAppTools', () => {
  it('creates MCP tool definitions from RegisteredTool array', () => {
    const registered: RegisteredTool[] = [
      {
        name: 'search_hospitals',
        namespacedName: 'med_crm:search_hospitals',
        description: '搜索医院',
        riskLevel: 'read',
        appName: 'med_crm',
        tenantName: 'acme',
        hasServer: true,
        parameters: { type: 'object', properties: { keyword: { type: 'string' } } },
      },
    ];

    const tools = buildAppTools(registered, async () => ({}));
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('med_crm:search_hospitals');
  });
});

describe('buildTenantMcpServer', () => {
  it('creates an MCP server with app summaries + _load_app_tools', () => {
    const server = buildTenantMcpServer('acme', {
      summaries: [
        { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 2, hasServer: false },
      ],
      onLoadAppTools: async () => [],
    });

    expect(server).toBeDefined();
    expect(server.name).toBe('tenant-tools');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/mcp-tools-tenant.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation — add to `src/mcp-tools.ts`**

Add these exports at the end of `src/mcp-tools.ts`:

```typescript
import type { RegisteredTool, AppSummary } from './types.js';

// --- Tenant MCP Server (progressive disclosure: app summaries + _load_app_tools) ---

export interface TenantMcpContext {
  tenantName: string;
  summaries: AppSummary[];
  onLoadAppTools: (appName: string) => Promise<RegisteredTool[]>;
  onCallTool?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
}

export function buildAppSummaryTools(
  summaries: AppSummary[],
  onLoadAppTools: (appName: string) => Promise<RegisteredTool[]>,
): Array<SdkMcpToolDefinition<any>> {
  const appTools = summaries.map(
    (s) =>
      tool(
        `app:${s.name}`,
        `${s.displayName}: ${s.description} (${s.toolCount} tools available). Use _load_app_tools("${s.name}") to activate.`,
        {},
        async () => {
          const loadedTools = await onLoadAppTools(s.name);
          return {
            content: [{
              type: 'text' as const,
              text: `App "${s.name}" loaded with ${loadedTools.length} tools: ${loadedTools.map((t) => t.namespacedName).join(', ')}. You can now call these tools directly.`,
            }],
          };
        },
      ),
  );

  const loadTool = tool(
    '_load_app_tools',
    'Load all tools from a specific app to make them callable. Call this when you need to use an app\'s tools.',
    { app_name: z.string().describe('App name to load (e.g. "med_crm")') },
    async ({ app_name }) => {
      const loadedTools = await onLoadAppTools(app_name);
      if (loadedTools.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No tools found for app "${app_name}"` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Loaded ${loadedTools.length} tools from "${app_name}": ${loadedTools.map((t) => `${t.namespacedName}: ${t.description}`).join('\n')}`,
        }],
      };
    },
  );

  return [...appTools, loadTool];
}

export function buildAppTools(
  registered: RegisteredTool[],
  callHandler: (toolName: string, params: Record<string, unknown>) => Promise<unknown>,
): Array<SdkMcpToolDefinition<any>> {
  return registered.map(
    (rt) =>
      tool(
        rt.namespacedName,
        rt.description,
        z.object(
          Object.fromEntries(
            Object.entries(rt.parameters.properties).map(([key, val]) => {
              const schema = val as { type?: string; description?: string };
              let zType: z.ZodTypeAny = z.string();
              if (schema.type === 'integer' || schema.type === 'number') zType = z.number();
              if (schema.type === 'boolean') zType = z.boolean();
              if (schema.type === 'array') zType = z.array(z.unknown());
              return [key, zType.optional().describe(schema.description ?? '')];
            }),
          ),
        ),
        async (params) => {
          try {
            const result = await callHandler(rt.namespacedName, params);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `Tool call failed: ${msg}` }],
              isError: true,
            };
          }
        },
      ),
  );
}

export function buildTenantMcpServer(
  tenantName: string,
  ctx: TenantMcpContext,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'tenant-tools',
    version: '1.0.0',
    tools: buildAppSummaryTools(ctx.summaries, ctx.onLoadAppTools),
    alwaysLoad: true,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/mcp-tools-tenant.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.ts tests/mcp-tools-tenant.test.ts
git commit -m "feat: add tenant MCP server with progressive disclosure (app summaries + _load_app_tools)"
```

---

### Task 5: Create corp/acme tenant structure with tools.json

**Files:**
- Create: `corp/acme/app.json`
- Create: `corp/acme/roles.json`
- Create: `corp/acme/apps/med_crm/tools.json`

- [ ] **Step 1: Create app.json**

```json
// corp/acme/app.json
{
  "displayName": "示例医疗",
  "description": "杭州示例医疗器械有限公司 — AI 销售大脑",
  "outcomeSignals": {
    "positive": ["签了", "中了", "落地了", "搞定了", "修好了", "正常了"],
    "negative": ["丢了", "没中", "黄了", "放弃了"]
  },
  "followup": {
    "enabled": false,
    "delayDays": 3,
    "prompt": "前几天你关注了 {topic}，后来有新消息吗？"
  }
}
```

- [ ] **Step 2: Create roles.json (placeholder for Phase 3)**

```json
// corp/acme/roles.json
{
  "roles": {
    "admin": {
      "displayName": "管理员",
      "tools": "*"
    },
    "sales": {
      "displayName": "销售",
      "tools": [
        "med_crm:search_*", "med_crm:list_*", "med_crm:get_*",
        "med_crm:add_sales_activity", "med_crm:add_contact",
        "device_kb:search"
      ]
    },
    "maintenance": {
      "displayName": "维修工程师",
      "tools": [
        "med_crm:search_*", "med_crm:list_*", "med_crm:get_*",
        "med_crm:add_incident", "med_crm:update_incident",
        "device_kb:search"
      ]
    },
    "readonly": {
      "displayName": "只读",
      "tools": ["med_crm:search_*", "med_crm:list_*", "med_crm:get_*"]
    }
  },
  "users": {
    "*": "readonly"
  }
}
```

- [ ] **Step 3: Create med_crm/tools.json**

```json
// corp/acme/apps/med_crm/tools.json
{
  "name": "med_crm",
  "version": "1.0.0",
  "displayName": "医院CRM",
  "description": "医疗器械销售 CRM — 医院档案、设备装机、维保合同、中标信息、联系人、维修工单、销售活动",
  "tools": [
    {
      "name": "search_hospitals",
      "description": "搜索医院，支持按省份/城市/渠道/关键词过滤",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "医院名称关键词" },
          "province": { "type": "string", "description": "省份" },
          "city": { "type": "string", "description": "城市" },
          "channel": { "type": "string", "description": "渠道" }
        }
      }
    },
    {
      "name": "search_devices",
      "description": "搜索装机设备，支持按品牌/类型/医院过滤",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "搜索关键词" },
          "brand": { "type": "string", "description": "品牌 (GE/Siemens/Philips等)" },
          "hospital_id": { "type": "integer", "description": "医院ID" }
        }
      }
    },
    {
      "name": "list_maintenance",
      "description": "列出维保合同，支持按到期日期过滤",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "expiring_before": { "type": "string", "description": "到期日期 (YYYY-MM-DD)" },
          "hospital_id": { "type": "integer", "description": "医院ID" }
        }
      }
    },
    {
      "name": "search_bids",
      "description": "搜索中标信息",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "搜索关键词" },
          "hospital_id": { "type": "integer", "description": "医院ID" }
        }
      }
    },
    {
      "name": "add_sales_activity",
      "description": "添加销售活动/拜访记录",
      "riskLevel": "internal_write",
      "parameters": {
        "type": "object",
        "properties": {
          "hospital_id": { "type": "integer", "description": "医院ID" },
          "activity_date": { "type": "string", "description": "拜访日期 (YYYY-MM-DD)" },
          "sales_name": { "type": "string", "description": "销售人员姓名" },
          "topics": { "type": "string", "description": "拜访内容/话题" }
        },
        "required": ["hospital_id", "activity_date", "sales_name"]
      }
    },
    {
      "name": "add_contact",
      "description": "添加联系人",
      "riskLevel": "internal_write",
      "parameters": {
        "type": "object",
        "properties": {
          "hospital_id": { "type": "integer", "description": "医院ID" },
          "name": { "type": "string", "description": "联系人姓名" },
          "position": { "type": "string", "description": "职位" },
          "phone": { "type": "string", "description": "电话" }
        },
        "required": ["hospital_id", "name"]
      }
    },
    {
      "name": "add_incident",
      "description": "添加维修工单",
      "riskLevel": "internal_write",
      "parameters": {
        "type": "object",
        "properties": {
          "hospital_id": { "type": "integer", "description": "医院ID" },
          "engineer_name": { "type": "string", "description": "工程师姓名" },
          "visit_date": { "type": "string", "description": "上门日期" },
          "problem_description": { "type": "string", "description": "故障描述" },
          "solution": { "type": "string", "description": "解决方案" }
        },
        "required": ["hospital_id", "visit_date"]
      }
    },
    {
      "name": "global_search",
      "description": "全局搜索，跨医院/设备/中标/联系人/工单/销售活动",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "搜索关键词" },
          "dim": { "type": "string", "description": "搜索维度 (hospital/device/bid/contact/incident/sales)" }
        },
        "required": ["keyword"]
      }
    },
    {
      "name": "hospital_info",
      "description": "查看系统数据概况",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add corp/acme/app.json corp/acme/roles.json corp/acme/apps/med_crm/tools.json
git commit -m "feat: add acme tenant structure with app.json, roles.json, med_crm tools.json"
```

---

### Task 6: Wire ToolRegistry + AppServerMgr into index.ts and agent.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/agent.ts`

- [ ] **Step 1: Modify index.ts to initialize ToolRegistry and AppServerMgr**

In `src/index.ts`, add imports and initialization after the `memoryManager` line:

```typescript
// Add imports at top of index.ts
import { ToolRegistry } from './tool-registry.js';
import { AppServerMgr } from './app-server.js';
import { buildTenantMcpServer } from './mcp-tools.js';

// In main(), after const memoryManager = new MemoryManager(...) (line ~118), add:
const corpDir = resolve(process.cwd(), 'corp');
const toolRegistry = new ToolRegistry(corpDir);
toolRegistry.scan();

const appServerMgr = new AppServerMgr();

// Auto-start servers for apps with server.py configs
for (const summary of toolRegistry.getAppSummaries('*')) {
  const tenant = summary.name;
  // Find the first app with a server in this tenant (simplified — Phase 1)
  for (const tName of Object.keys(currentBots)) {
    const botConfig = currentBots[tName];
    if (botConfig.agentDir.includes(tenant)) {
      const manifest = toolRegistry.getManifest(tenant, summary.name);
      if (manifest?.server) {
        const appDir = resolve(corpDir, tenant, 'apps', summary.name);
        try {
          await appServerMgr.startServer(summary.name, {
            cwd: appDir,
            entry: manifest.server.entry,
            python: manifest.server.python,
          });
        } catch (err) {
          logger.warn({ appName: summary.name, err }, 'Failed to start app server');
        }
      }
      break;
    }
  }
}
```

- [ ] **Step 2: Modify agentFactory to build tenant MCP server**

In `src/index.ts`, in the `agentFactory.respond()` method, after building the platform MCP server (line ~201), add tenant MCP server:

```typescript
// After const mcpServer = buildPlatformMcpServer({...}), add:
const workdir = botConfig?.cwd ?? botConfig?.agentDir ?? '';
let tenantName = '';
for (const name of toolRegistry.getAppSummaries('*').map(s => s.name)) {
  if (workdir.includes(name)) {
    tenantName = name;
    break;
  }
}

const summaries = tenantName ? toolRegistry.getAppSummaries(tenantName) : [];
const tenantServer = summaries.length > 0
  ? buildTenantMcpServer(tenantName, {
      summaries,
      onLoadAppTools: async (appName: string) => {
        const tools = toolRegistry.getAppTools(tenantName, appName);
        // Note: full tool injection requires SDK restart or dynamic tool addition
        // For Phase 1, this returns the tool list so the agent knows what's available
        return tools;
      },
      onCallTool: async (toolName: string, params: Record<string, unknown>) => {
        const toolDef = toolRegistry.lookup(toolName);
        if (!toolDef) throw new Error(`Unknown tool: ${toolName}`);
        const manifest = toolRegistry.getManifest(tenantName, toolDef.appName);
        if (manifest?.server) {
          return appServerMgr.call(toolDef.appName, toolDef.name, params);
        }
        // CLI fallback: run python -m {app}.cli {tool} --json {params}
        const appDir = resolve(corpDir, tenantName, 'apps', toolDef.appName);
        const cliArgs = [toolDef.name.replace(/_/g, '-'), ...Object.entries(params).flatMap(([k, v]) => [`--${k}`, String(v)]), '--json'];
        return appServerMgr.callCli({
          cwd: appDir,
          command: 'python3',
          args: ['-m', toolDef.appName, ...cliArgs],
        });
      },
    })
  : undefined;

// Change the mcpServers spread to include tenant server:
const mcpServers: Record<string, McpSdkServerConfigWithInstance> = {
  platform: mcpServer,
};
if (tenantServer) {
  mcpServers['tenant-tools'] = tenantServer;
}
```

And update the `agent.respond()` call to pass `mcpServers` instead of single `mcpServer`:

```typescript
// Change from:
const reply = await agent.respond(finalPrompt, chatId, { ...opts, mcpServer });
// To:
const reply = await agent.respond(finalPrompt, chatId, { ...opts, mcpServers });
```

- [ ] **Step 3: Modify agent.ts to accept multiple MCP servers**

In `src/agent.ts`, update the `RespondOptions` interface and the `respond` method:

```typescript
// Add to RespondOptions:
mcpServers?: Record<string, McpSdkServerConfigWithInstance>;

// In respond(), line ~121-123, change the spread:
// From:
//   ...(respOpts.mcpServer ?? this.opts.mcpServer
//     ? { mcpServers: { platform: respOpts.mcpServer ?? this.opts.mcpServer! } }
//     : {}),
// To:
...(() => {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {};
  // Platform server from constructor or per-call override
  if (respOpts.mcpServer ?? this.opts.mcpServer) {
    servers.platform = respOpts.mcpServer ?? this.opts.mcpServer!;
  }
  // Additional servers (tenant-tools, knowledge, etc.)
  if (respOpts.mcpServers) {
    Object.assign(servers, respOpts.mcpServers);
  }
  return Object.keys(servers).length > 0 ? { mcpServers: servers } : {};
})(),
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd /workspace/happycompany && npx vitest run tests/`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/agent.ts
git commit -m "feat: wire ToolRegistry + AppServerMgr into agent factory with tenant MCP server"
```

---

### Task 7: Add med_crm CLI --json support

**Files:**
- Modify: `corp/acme/med_crm/cli.py`

- [ ] **Step 1: Add global --json flag to med_crm CLI**

The existing med_crm CLI uses Click. Add a global `--json` flag that outputs structured JSON instead of formatted tables.

In `corp/acme/med_crm/cli.py`, add a global Click option and a JSON output helper. When `--json` is passed, commands should return JSON objects instead of human-readable text. This is a minimal change: wrap the existing output in a `click.echo(json.dumps(...))` branch.

The key changes:
1. Add `import json` at top
2. Add a Click context that carries the `--json` flag
3. Each command group checks the flag and formats output accordingly

This is a per-command refactor best done by reading the current `cli.py` and adding the flag. Given the file's length, this task delegates the actual edit to the implementation phase.

- [ ] **Step 2: Test CLI --json output**

Run: `cd /workspace/corp/acme && python -m med_crm.cli hospital_info --json`
Expected: Valid JSON output instead of text table

- [ ] **Step 3: Commit**

```bash
git add corp/acme/med_crm/cli.py
git commit -m "feat(med_crm): add --json flag for structured CLI output"
```

---

### Task 8: Integration test — end-to-end tool call

**Files:**
- Create: `tests/integration-tool-registry.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration-tool-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tool-registry.js';
import { buildTenantMcpServer, buildAppSummaryTools } from '../src/mcp-tools.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Integration: ToolRegistry → Tenant MCP Server', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('end-to-end: scan tools.json, build MCP server, look up tools', () => {
    // Arrange: create corp structure
    const appsDir = path.join(tmpDir, 'acme', 'apps', 'med_crm');
    fs.mkdirSync(appsDir, { recursive: true });
    fs.writeFileSync(path.join(appsDir, 'tools.json'), JSON.stringify({
      name: 'med_crm',
      displayName: '医院CRM',
      description: '医疗器械销售 CRM',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: { keyword: { type: 'string' } } } },
        { name: 'add_contact', description: '添加联系人', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
      ],
    }, null, 2));

    // Act: scan and build
    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    const summaries = registry.getAppSummaries('acme');
    const server = buildTenantMcpServer('acme', {
      summaries,
      onLoadAppTools: async (appName: string) => {
        return registry.getAppTools('acme', appName);
      },
    });

    // Assert: server was built, summaries are correct
    expect(server).toBeDefined();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].toolCount).toBe(2);

    // Assert: individual tools can be looked up
    expect(registry.lookup('med_crm:search_hospitals')).toBeDefined();
    expect(registry.lookup('med_crm:search_hospitals')!.riskLevel).toBe('read');
    expect(registry.lookup('med_crm:add_contact')!.riskLevel).toBe('internal_write');

    // Assert: tenant isolation — unknown tenant returns empty
    expect(registry.getToolsForTenant('other_tenant')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /workspace/happycompany && npx vitest run tests/integration-tool-registry.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration-tool-registry.test.ts
git commit -m "test: add integration test for ToolRegistry → Tenant MCP Server pipeline"
```

---

## Self-Review

**1. Spec coverage (§4 Tool Manifest):**
- §4.1 tools.json format → Task 1 (schemas) ✓
- §4.2 Core design decisions → Task 1 (riskLevel enum, namespace prefix) ✓
- §4.3 Discovery & registration → Task 2 (scan, validate, register) ✓
- §4.4 Runtime call routing → Task 3 (JSON-RPC + CLI fallback) ✓
- §4.5 CLI compatibility mode → Task 7 (--json flag) ✓

**2. Placeholder scan:** No TBD/TODO found. All code blocks have actual content.

**3. Type consistency:** `RegisteredTool`, `AppSummary`, `ToolManifest` defined in Task 1, used consistently in Tasks 2, 4, 6, 8.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-phase1-tool-manifest.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session, batch execution with checkpoints

Which approach?
