# HappyCompany Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight multi-platform IM platform (Feishu + DingTalk) that serves versioned domain Apps to enterprise clients via Claude sessions, with admin-driven iteration.

**Architecture:** TypeScript platform skeleton (from bot-swarm) with ChannelAdapter interface for multi-IM support. Python for App CLI/business code. 1:1 Bot↔Workdir binding, skill auto-routing, App registry with version management. No topology, no Docker, no fan-out.

**Tech Stack:** TypeScript/ESM, Hono, React 19/Vite/Tailwind 4, better-sqlite3, Zod, pino, @larksuiteoapi/node-sdk, dingtalk-stream, @anthropic-ai/claude-agent-sdk, Python/SQLAlchemy/Click (App layer)

**Spec:** `happycompany/specs/2026-05-02-happycompany-concept-design.md`

---

## Architecture Constraints

### MUST DO

| # | 约束 | 理由 |
|---|------|------|
| C1 | 所有 IM 操作通过 ChannelAdapter 接口，不直接调用任何平台 SDK | 多平台解耦 |
| C2 | Bot 与 Workdir 严格 1:1，换绑 = 清 session | context 一致性 |
| C3 | Skill 只声明接口，不含业务逻辑，业务在 CLI/App 代码中 | 可复用性 |
| C4 | App 三层结构：README.md + CLAUDE.md + 代码，三者必须一致 | 产品 ↔ 实现对齐 |
| C5 | System Dir 与 Workdir 完全隔离，通过安装流程连接 | 安全 + 版本控制 |
| C6 | 变更通过安装流程分发，安装后 session 重载生效 | 可预测，可回滚 |
| C7 | 所有外部输入（用户消息、API 响应、文件内容）在系统边界校验 | 安全 |
| C8 | 测试覆盖率 >= 80%，核心路径必须有集成测试 | 质量保障 |
| C9 | 使用 pino logger，不用 console.log | 统一日志 |

### MUST NOT DO

| # | 禁止 | 理由 |
|---|------|------|
| X1 | 不引入拓扑 DAG / fan-out 机制 | 统一平台是 1:1 模型，不需要复杂编排 |
| X2 | 不使用 Docker 容器隔离 | 暂不需要，进程内 session 足够 |
| X3 | 不自动生成 App 代码 | 管理员手动迭代，不搞 wish→build |
| X4 | 不在 ChannelAdapter 接口内暴露任何平台特定类型 | 解耦 |
| X5 | 不在 Python App 代码中直接调用 IM SDK | 双语言通过 CLI 接口通信 |
| X6 | 不引入文件级 IPC（fs.watch） | 不可靠，用进程内事件或数据库 |
| X7 | 不在 source file 中硬编码密钥 | 环境变量 + config.json |
| X8 | 不使用 any 类型 | TypeScript 严格模式 |

---

## Test Stories

### S1: 飞书私聊基础流程

```
Given: 一个配置好的 Bot（飞书 channel + workdir + Claude session）
When: 用户在飞书私聊发送 "你好"
Then:
  1. FeishuChannel 收到消息
  2. DedupCache 首次 claim 返回 true
  3. MessageStore 记录消息
  4. MessageBus 发布 message_received 事件
  5. ClaudeAgent.respond() 返回回复
  6. FeishuChannel 通过 StreamingCard 发送回复
  7. MessageStore 记录回复
```

### S2: 飞书群聊 @路由

```
Given: 群聊中有 Bot A 和 Bot B
When: 用户 @Bot A "查一下招标"
Then:
  1. Bot A 的 shouldRespond() 返回 true（被 @）
  2. Bot B 的 shouldRespond() 返回 false（未被 @）
  3. Bot A 的 session 被注入 desc："Bot A 做什么、Bot B 做什么"
  4. 只有 Bot A 回复
```

### S3: 钉钉私聊基础流程

```
Given: 一个配置好的 Bot（钉钉 channel + workdir + Claude session）
When: 用户在钉钉私聊发送 "你好"
Then:
  1. DingTalkChannel 收到消息
  2. 走同样的 Dedup → Store → Bus → Agent → Channel 回复流程
  3. 回复通过 DingTalkStreamingCard 发送
```

### S4: 钉钉群聊文件处理

```
Given: 群聊中有 Bot，用户发送了一个 Excel 文件
When: Bot 收到消息
Then:
  1. DingTalkChannel 检测到文件类型消息
  2. 通过 downloadCode API 下载文件
  3. 文本内容提取（extractFileText）
  4. 内容以 nonce fenced block 注入 prompt
  5. Claude 能基于文件内容回答问题
```

### S5: Skill 路由

```
Given: workdir 安装了 hospital-crm app（含 bid-query skill）
When: 用户说 "帮我查浙江最近的监护仪中标"
Then:
  1. Claude 通过 SKILL.md 知道有 bid-query skill
  2. Skill 指导 Claude 调用 CLI: hospital-search --keyword "监护仪" --province "浙江"
  3. CLI 返回中标列表
  4. Claude 格式化回复
```

### S6: App 安装与版本更新

```
Given: System Dir 有 hospital-crm v1.0 和 v1.1
When: 管理员执行 install --app hospital-crm --version v1.1 到某 workdir
Then:
  1. installed.json 更新版本号为 v1.1
  2. workdir/.claude/skills/ 更新为新版本的 skill 文件
  3. 下次 session 启动时加载 v1.1
```

### S7: /clear 命令

```
Given: Bot 有活跃的 session
When: 用户发送 "/clear"
Then:
  1. ClaudeAgent.clearSession() 删除 session 文件
  2. 回复确认消息
  3. 下次消息创建全新 session
```

### S8: 消息去重

```
Given: DedupCache 配置 30min TTL
When: 同一条消息（相同 messageId）重复到达
Then:
  1. 第一次 claim() 返回 true
  2. 第二次 claim() 返回 false
  3. 只有第一次触发 agent 回复
```

### S9: 管理后台 App 管理

```
Given: 管理后台 Web UI 运行中
When: 管理员在 UI 中查看 App 列表
Then:
  1. 显示所有已注册 App 及版本号
  2. 可以查看 App 的 README.md（产品说明书）
  3. 可以编辑 App 代码
  4. 可以发布新版本
```

### S10: 使用统计

```
Given: 系统运行一段时间，有消息记录
When: 管理员查看使用统计
Then:
  1. 显示每个 skill 的调用次数
  2. 显示每个 Bot 的消息量趋势
  3. 显示用户反馈（如果有）
```

---

## Phase 1: Core Skeleton

**目标**: 一个飞书 Bot 收消息 → Claude Session 回复 → 流式卡片 → 基础 Web 界面。最小闭环。

**源文件**: 大部分从 bot-swarm 适配，去掉拓扑系统。

### File Structure (Phase 1)

```
happycompany/
├── src/
│   ├── index.ts              # 入口：加载配置 → 启动 bots → 启动 web
│   ├── types.ts              # 核心类型（NormalizedMessage, BotConfig 等）
│   ├── config.ts             # Zod 配置 schema + 加载
│   ├── channel.ts            # ChannelAdapter 接口 + StreamingHandle 接口
│   ├── feishu.ts             # FeishuChannel（适配 bot-swarm/feishu-bot.ts）
│   ├── streaming-card.ts     # 飞书流式卡片（直接复用 bot-swarm）
│   ├── agent.ts              # Claude Session（适配 bot-swarm/agent.ts）
│   ├── bot.ts                # BotUnit：channel + agent + workdir 绑定 + 消息路由
│   ├── dedup.ts              # 消息去重（直接复用 bot-swarm/dedup.ts）
│   ├── bus.ts                # 事件总线（直接复用 bot-swarm/message-bus.ts）
│   ├── store.ts              # SQLite 消息存储（直接复用 bot-swarm/message-store.ts）
│   ├── logger.ts             # Pino logger（直接复用 bot-swarm/logger.ts）
│   └── web.ts                # Hono HTTP + WebSocket
├── tests/
│   ├── types.test.ts
│   ├── config.test.ts
│   ├── dedup.test.ts
│   ├── bus.test.ts
│   ├── store.test.ts
│   ├── agent.test.ts
│   └── bot.test.ts
├── package.json
├── tsconfig.json
├── config.example.json
├── vitest.config.ts
└── CLAUDE.md
```

---

### Task 1: Project Setup

**Files:**
- Create: `happycompany/package.json`
- Create: `happycompany/tsconfig.json`
- Create: `happycompany/vitest.config.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "happycompany",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "*",
    "@hono/node-server": "^2.0.0",
    "@larksuiteoapi/node-sdk": "^1.58.0",
    "better-sqlite3": "^12.9.0",
    "hono": "^4.12.15",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "ws": "^8.20.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.19.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Install dependencies and verify**

Run: `cd happycompany && npm install && npx vitest run`
Expected: All pass (no tests yet)

- [ ] **Step 5: Commit**

```bash
git add happycompany/
git commit -m "chore: initialize happycompany project scaffold"
```

---

### Task 2: Core Types

**Files:**
- Create: `src/types.ts`
- Create: `src/channel.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/types.test.ts
import { describe, it, expect } from 'vitest';
import type { NormalizedMessage, BotConfig, FileAttachment } from '../src/types.js';
import type { ChannelAdapter, StreamingHandle } from '../src/channel.js';

describe('NormalizedMessage', () => {
  it('creates a user message', () => {
    const msg: NormalizedMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      text: 'hello',
      source: 'user',
      channelId: 'feishu',
      receivedAt: Date.now(),
    };
    expect(msg.source).toBe('user');
    expect(msg.channelId).toBe('feishu');
  });

  it('creates a message with file attachment', () => {
    const file: FileAttachment = {
      type: 'file',
      name: 'report.xlsx',
      localPath: '/tmp/report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const msg: NormalizedMessage = {
      id: 'msg-2',
      chatId: 'chat-1',
      text: '',
      source: 'user',
      channelId: 'dingtalk',
      receivedAt: Date.now(),
      files: [file],
    };
    expect(msg.files).toHaveLength(1);
    expect(msg.files![0].name).toBe('report.xlsx');
  });
});

describe('ChannelAdapter interface', () => {
  it('is implemented by a mock class', () => {
    class MockChannel implements ChannelAdapter {
      name = 'mock';
      async start() {}
      async stop() {}
      onMessage() { return () => {}; }
      onCardAction() { return () => {}; }
      async send() {}
      sendStreaming() {
        return {
          update() {},
          finalize() {},
          updateToolStatus() {},
          abort() {},
          delete() {},
        } satisfies StreamingHandle;
      }
      async react() {}
      async downloadFile() {
        return { type: 'file', name: 'test.txt', localPath: '/tmp/test.txt', textContent: 'hello' };
      }
    }
    const ch = new MockChannel();
    expect(ch.name).toBe('mock');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL — cannot import from ../src/types.js

- [ ] **Step 3: Implement types.ts**

```typescript
// src/types.ts
export type MessageSource = 'user' | 'bot' | 'self';

export interface FileAttachment {
  type: 'file' | 'image';
  name: string;
  localPath: string;
  mimeType?: string;
  textContent?: string;
  base64?: string;
}

/**
 * Platform-agnostic message. All channels must produce this shape.
 */
export interface NormalizedMessage {
  id: string;
  chatId: string;
  text: string;
  source: MessageSource;
  channelId: string;
  fromBotName?: string;
  receivedAt: number;
  replyTo?: {
    messageId: string;
    text: string;
    files?: FileAttachment[];
  };
  files?: FileAttachment[];
}

export interface BotConfig {
  name: string;
  channel: 'feishu' | 'dingtalk';
  /** Channel-specific credentials (appId/appSecret or clientId/clientSecret). */
  credentials: Record<string, string>;
  displayName: string;
  reactionEmoji?: string;
  agentDir: string;
  /** Real working directory for Claude session (defaults to agentDir). */
  cwd?: string;
  model?: string;
}

export interface BotRuntime {
  name: string;
  config: BotConfig;
  channel: ChannelAdapter;
}
```

- [ ] **Step 4: Implement channel.ts**

```typescript
// src/channel.ts
import type { NormalizedMessage, FileAttachment } from './types.js';

export interface StreamingHandle {
  update(text: string): void;
  finalize(text: string): void;
  updateToolStatus(info: { toolName: string; status: 'running' | 'complete' | 'error'; elapsedMs?: number }): void;
  abort(): void;
  delete(): void;
}

export interface CardAction {
  chatId: string;
  messageId: string;
  action: string;
  value?: Record<string, unknown>;
}

export interface DownloadedFile extends FileAttachment {
  textContent?: string;
  base64?: string;
}

/**
 * Platform-agnostic IM channel interface.
 * Each IM platform (Feishu, DingTalk) implements this.
 */
export interface ChannelAdapter {
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  onMessage(handler: (msg: NormalizedMessage) => void): () => void;
  onCardAction(handler: (action: CardAction) => void): () => void;

  send(chatId: string, text: string): Promise<void>;
  sendStreaming(chatId: string): StreamingHandle;

  react(messageId: string, emoji: string): Promise<void>;
  downloadFile(fileRef: { messageId: string; fileName: string }): Promise<DownloadedFile>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/channel.ts tests/types.test.ts
git commit -m "feat: add core types and ChannelAdapter interface"
```

---

### Task 3: Config Schema

**Files:**
- Create: `src/config.ts`
- Create: `config.example.json`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('config', () => {
  const tmpDir = join(tmpdir(), 'happycompany-test-config');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid config', () => {
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      bots: {
        'my-bot': {
          channel: 'feishu',
          credentials: { appId: '$FEISHU_APP_ID', appSecret: '$FEISHU_APP_SECRET' },
          displayName: 'My Bot',
          agentDir: './agents/my-bot',
        },
      },
      claude: { apiKey: '$ANTHROPIC_API_KEY' },
    }));
    process.env.FEISHU_APP_ID = 'test-app-id';
    process.env.FEISHU_APP_SECRET = 'test-secret';
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const config = loadConfig(configPath);
    expect(config.bots['my-bot'].channel).toBe('feishu');
    expect(config.bots['my-bot'].credentials.appId).toBe('test-app-id');
    expect(config.bots['my-bot'].displayName).toBe('My Bot');

    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('throws on missing env var', () => {
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      bots: {},
      claude: { apiKey: '$MISSING_KEY' },
    }));
    expect(() => loadConfig(configPath)).toThrow('MISSING_KEY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config.ts**

简化 bot-swarm 的 config：去掉 topology，改为 flat bots 列表。

```typescript
// src/config.ts
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BotCredentialsSchema = z.object({
  appId: z.string().min(1).optional(),
  appSecret: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
});

const BotSchema = z.object({
  channel: z.enum(['feishu', 'dingtalk']),
  credentials: BotCredentialsSchema,
  displayName: z.string().min(1),
  reactionEmoji: z.string().optional(),
  agentDir: z.string().min(1),
  cwd: z.string().min(1).optional(),
  model: z.string().optional(),
});

const ClaudeSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().nullable().optional(),
});

const WebSchema = z.object({
  port: z.number().int().positive().default(3100),
});

export const ConfigSchema = z.object({
  bots: z.record(z.string(), BotSchema),
  claude: ClaudeSchema.default({}),
  web: WebSchema.default({}),
  dataDir: z.string().default('data'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path = 'config.json'): Config {
  const abs = resolve(process.cwd(), path);
  const raw = readFileSync(abs, 'utf-8');
  const json = JSON.parse(raw);
  const resolved = expandEnvVars(json);
  return ConfigSchema.parse(resolved);
}

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const envName = value.slice(1);
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(`Config references env var $${envName} but it is not set`);
    }
    return envValue;
  }
  if (Array.isArray(value)) return value.map(expandEnvVars);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnvVars(v);
    return out;
  }
  return value;
}
```

- [ ] **Step 4: Create config.example.json**

```json
{
  "bots": {
    "hospital-crm-bot": {
      "channel": "feishu",
      "credentials": {
        "appId": "$FEISHU_APP_ID",
        "appSecret": "$FEISHU_APP_SECRET"
      },
      "displayName": "医院CRM助手",
      "agentDir": "./agents/hospital-crm",
      "reactionEmoji": "CROWN"
    }
  },
  "claude": {
    "apiKey": "$ANTHROPIC_API_KEY"
  },
  "web": { "port": 3100 },
  "dataDir": "data"
}
```

- [ ] **Step 5: Run tests, verify pass, typecheck**

Run: `npx vitest run tests/config.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config.ts config.example.json tests/config.test.ts
git commit -m "feat: add Zod config schema (no topology, flat bots)"
```

---

### Task 4: Logger + Event Bus + Dedup + Message Store

**Files:**
- Create: `src/logger.ts`
- Create: `src/bus.ts`
- Create: `src/dedup.ts`
- Create: `src/store.ts`
- Test: `tests/dedup.test.ts`, `tests/bus.test.ts`, `tests/store.test.ts`

这四个文件是基础设施，从 bot-swarm 直接复制，仅做 import path 调整。

- [ ] **Step 1: Write failing tests**

```typescript
// tests/dedup.test.ts
import { describe, it, expect } from 'vitest';
import { DedupCache } from '../src/dedup.js';

describe('DedupCache', () => {
  it('returns true on first claim', () => {
    const cache = new DedupCache(100, 60000);
    expect(cache.claim('msg-1')).toBe(true);
  });

  it('returns false on duplicate claim', () => {
    const cache = new DedupCache(100, 60000);
    cache.claim('msg-1');
    expect(cache.claim('msg-1')).toBe(false);
  });

  it('returns true after TTL expires', () => {
    const cache = new DedupCache(100, 0);
    cache.claim('msg-1');
    // TTL is 0ms, so next claim should succeed
    expect(cache.claim('msg-1')).toBe(true);
  });

  it('evicts oldest when at capacity', () => {
    const cache = new DedupCache(2, 60000);
    cache.claim('a');
    cache.claim('b');
    cache.claim('c'); // evicts 'a'
    expect(cache.claim('a')).toBe(true); // 'a' was evicted
    expect(cache.claim('b')).toBe(false); // 'b' still present
  });
});
```

```typescript
// tests/bus.test.ts
import { describe, it, expect } from 'vitest';
import { MessageBus } from '../src/bus.js';

describe('MessageBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new MessageBus(10);
    const events: unknown[] = [];
    bus.subscribe((ev) => events.push(ev));
    bus.publish({ type: 'message_received', botName: 'test' });
    expect(events).toHaveLength(1);
  });

  it('buffers events up to max', () => {
    const bus = new MessageBus(3);
    for (let i = 0; i < 5; i++) bus.publish({ type: 'message_received' });
    expect(bus.snapshot()).toHaveLength(3);
  });

  it('unsubscribe stops receiving events', () => {
    const bus = new MessageBus(10);
    const events: unknown[] = [];
    const unsub = bus.subscribe((ev) => events.push(ev));
    bus.publish({ type: 'message_received' });
    unsub();
    bus.publish({ type: 'message_received' });
    expect(events).toHaveLength(1);
  });
});
```

```typescript
// tests/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageStore } from '../src/store.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

describe('MessageStore', () => {
  const dbPath = join(tmpdir(), 'test-store.db');
  let store: MessageStore;

  beforeEach(() => {
    mkdirSync(tmpdir(), { recursive: true });
    store = new MessageStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
  });

  it('inserts and retrieves messages', () => {
    store.insert({
      id: 'msg-1', chatId: 'chat-1', timestamp: 1,
      text: 'hello', source: 'user',
    });
    const msgs = store.listMessages('chat-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('hello');
  });

  it('ignores duplicate inserts', () => {
    store.insert({ id: 'msg-1', chatId: 'chat-1', timestamp: 1, text: 'a', source: 'user' });
    store.insert({ id: 'msg-1', chatId: 'chat-1', timestamp: 1, text: 'b', source: 'user' });
    expect(store.listMessages('chat-1')).toHaveLength(1);
    expect(store.listMessages('chat-1')[0].text).toBe('a');
  });

  it('lists chats with summaries', () => {
    store.insert({ id: 'm1', chatId: 'c1', timestamp: 100, text: 'a', source: 'user' });
    store.insert({ id: 'm2', chatId: 'c2', timestamp: 200, text: 'b', source: 'user' });
    const chats = store.listChats();
    expect(chats).toHaveLength(2);
    expect(chats[0].chatId).toBe('c2'); // ordered by last message desc
  });

  it('clearAll removes all messages', () => {
    store.insert({ id: 'm1', chatId: 'c1', timestamp: 1, text: 'a', source: 'user' });
    const count = store.clearAll();
    expect(count).toBe(1);
    expect(store.listChats()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dedup.test.ts tests/bus.test.ts tests/store.test.ts`
Expected: FAIL

- [ ] **Step 3: Copy+adapt logger.ts, bus.ts, dedup.ts, store.ts from bot-swarm**

Source mappings:
- `bot-swarm/src/logger.ts` → `src/logger.ts` (no changes)
- `bot-swarm/src/message-bus.ts` → `src/bus.ts` (rename class: `MessageBus`, types: use `BusEvent`, drop `fanout_synthesized` event)
- `bot-swarm/src/dedup.ts` → `src/dedup.ts` (no changes)
- `bot-swarm/src/message-store.ts` → `src/store.ts` (change import path for logger)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dedup.test.ts tests/bus.test.ts tests/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts src/bus.ts src/dedup.ts src/store.ts tests/
git commit -m "feat: add logger, event bus, dedup cache, message store"
```

---

### Task 5: Feishu Channel

**Files:**
- Create: `src/feishu.ts`
- Create: `src/streaming-card.ts`

**Source**: `bot-swarm/src/feishu-bot.ts` → `src/feishu.ts`（适配 ChannelAdapter 接口）
**Source**: `bot-swarm/src/streaming-card.ts` → `src/streaming-card.ts`（直接复用）

关键适配点：
1. 构造函数接受 `BotConfig` 而非单独的 appId/appSecret
2. `onMessage` 回调产生 `NormalizedMessage` 而非 `IncomingMessage`
3. `send` / `sendStreaming` 返回 `StreamingHandle`
4. 去掉 `injectSynthetic`（无 fan-out）
5. 去掉 `chatJid` 等 happycompany 概念

- [ ] **Step 1: Copy streaming-card.ts from bot-swarm with import path fix**

Source: `bot-swarm/src/streaming-card.ts` → `src/streaming-card.ts`
Change: import logger from `./logger.js`

- [ ] **Step 2: Adapt feishu-bot.ts into FeishuChannel implementing ChannelAdapter**

从 `bot-swarm/src/feishu-bot.ts` 提取核心逻辑，包装成 `ChannelAdapter` 实现。

关键改动：
- 类名 `FeishuBot` → `FeishuChannel`
- 实现 `ChannelAdapter` 接口
- `handleMessageEvent` 内部把飞书事件转为 `NormalizedMessage`
- `send` 方法支持纯文本
- `sendStreaming` 返回 `StreamingHandle`（复用 `StreamingCard`）
- `downloadFile` 暂时抛 `NotImplementedError`（Phase 2 钉钉才需要）

- [ ] **Step 3: Manual test (requires Feishu credentials)**

Run: `npm run dev` with valid config.json
Expected: Feishu bot connects, receives message, responds via Claude

- [ ] **Step 4: Commit**

```bash
git add src/feishu.ts src/streaming-card.ts
git commit -m "feat: add Feishu channel (adapted from bot-swarm)"
```

---

### Task 6: Agent (Claude Session)

**Files:**
- Create: `src/agent.ts`
- Test: `tests/agent.test.ts`

**Source**: `bot-swarm/src/agent.ts` → `src/agent.ts`（去掉 `require` hack，用 ESM import）

关键改动：
- `loadSessions()` 中把 `require('node:fs')` 改为 `import { readdirSync } from 'node:fs'`
- 保持 `ClaudeAgent` 类名和 API 不变
- 增加 `clearAllSessions()` 方法

- [ ] **Step 1: Adapt agent.ts from bot-swarm**

- [ ] **Step 2: Commit**

```bash
git add src/agent.ts tests/agent.test.ts
git commit -m "feat: add Claude agent session wrapper"
```

---

### Task 7: Bot Unit (Message Routing)

**Files:**
- Create: `src/bot.ts`
- Test: `tests/bot.test.ts`

**This is the key architectural simplification.** bot-swarm 的 `swarm.ts` 有 800+ 行（拓扑、fan-out、递归防护）。统一平台的 `bot.ts` 只需要 200 行左右：一个 BotUnit = channel + agent + dedup。

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bot.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BotManager } from '../src/bot.js';
import type { ChannelAdapter, StreamingHandle, CardAction } from '../src/channel.js';
import type { NormalizedMessage } from '../src/types.js';

function mockChannel(name: string): ChannelAdapter & {
  _handler: ((msg: NormalizedMessage) => void) | null;
  _messages: Array<{ chatId: string; text: string }>;
} {
  return {
    name,
    _handler: null,
    _messages: [],
    async start() {},
    async stop() {},
    onMessage(handler) {
      this._handler = handler;
      return () => { this._handler = null; };
    },
    onCardAction() { return () => {}; },
    async send(chatId, text) { this._messages.push({ chatId, text }); },
    sendStreaming() {
      return {
        update() {}, finalize() {}, updateToolStatus() {}, abort() {}, delete() {},
      } satisfies StreamingHandle;
    },
    async react() {},
    async downloadFile() {
      return { type: 'file', name: 'test.txt', localPath: '/tmp/test.txt', textContent: 'hello' };
    },
  };
}

describe('BotManager', () => {
  it('creates and starts a bot', async () => {
    const mgr = new BotManager({
      bots: {
        'test-bot': {
          channel: 'mock',
          credentials: {},
          displayName: 'Test',
          agentDir: '/tmp/test-bot-agent',
        },
      },
    } as any, { respond: async () => 'hello' } as any, {} as any, {} as any);

    const ch = mockChannel('mock');
    await mgr.start({ 'test-bot': ch });
    expect(mgr.listBots()).toContain('test-bot');
    await mgr.stop();
  });

  it('routes message to agent and sends reply', async () => {
    let responded = false;
    const mgr = new BotManager(
      { bots: { b: { channel: 'mock', credentials: {}, displayName: 'B', agentDir: '/tmp/b' } } } as any,
      { respond: async () => { responded = true; return 'ok'; } } as any,
      {} as any, {} as any,
    );

    const ch = mockChannel('mock');
    await mgr.start({ b: ch });

    const msg: NormalizedMessage = {
      id: 'm1', chatId: 'c1', text: 'hi', source: 'user', channelId: 'mock', receivedAt: 1,
    };
    if (ch._handler) ch._handler(msg);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 50));
    expect(responded).toBe(true);

    await mgr.stop();
  });
});
```

- [ ] **Step 2: Implement bot.ts**

```typescript
// src/bot.ts
import type { NormalizedMessage, BotConfig } from './types.js';
import type { ChannelAdapter } from './channel.js';
import type { ClaudeAgent } from './agent.js';
import type { MessageBus } from './bus.js';
import type { MessageStore } from './store.js';
import type { DedupCache } from './dedup.js';
import { logger } from './logger.js';

interface BotDeps {
  config: { bots: Record<string, BotConfig> };
  agentFactory: Pick<ClaudeAgent, 'respond' | 'clearSession'>;
  bus: MessageBus;
  store: MessageStore;
  dedup: DedupCache;
}

interface BotInstance {
  name: string;
  config: BotConfig;
  channel: ChannelAdapter;
}

export class BotManager {
  private bots = new Map<string, BotInstance>();

  constructor(private deps: BotDeps) {}

  async start(channels: Record<string, ChannelAdapter>): Promise<void> {
    for (const [name, config] of Object.entries(this.deps.config.bots)) {
      const channel = channels[name];
      if (!channel) {
        throw new Error(`No channel provided for bot "${name}"`);
      }

      const instance: BotInstance = { name, config, channel };
      this.bots.set(name, instance);

      // Wire message handler
      channel.onMessage((msg) => this.handleMessage(instance, msg));

      await channel.start();
      this.deps.bus.publish({ type: 'bot_connected', botName: name });
      logger.info({ bot: name, channel: config.channel }, 'Bot started');
    }
  }

  async stop(): Promise<void> {
    for (const [name, instance] of this.bots) {
      try { await instance.channel.stop(); } catch (err) {
        logger.warn({ err, bot: name }, 'Bot stop error');
      }
      this.deps.bus.publish({ type: 'bot_disconnected', botName: name });
    }
    this.bots.clear();
  }

  listBots(): string[] {
    return [...this.bots.keys()];
  }

  private async handleMessage(bot: BotInstance, msg: NormalizedMessage): Promise<void> {
    // Dedup
    const dedupKey = `${bot.name}:${msg.id}`;
    if (!this.deps.dedup.claim(dedupKey)) return;

    // /clear command
    if (/^\/clear(\s|$)/.test(msg.text)) {
      this.deps.agentFactory.clearSession(msg.chatId);
      await bot.channel.send(msg.chatId, 'Session cleared.');
      return;
    }

    // Store incoming
    this.deps.store.insert({
      id: msg.id, chatId: msg.chatId, timestamp: msg.receivedAt,
      text: msg.text, source: msg.source, botName: bot.name,
    });
    this.deps.bus.publish({ type: 'message_received', botName: bot.name, chatId: msg.chatId, messageId: msg.id, text: msg.text });

    // Build prompt with file context
    let prompt = msg.text;
    if (msg.files?.length) {
      for (const f of msg.files) {
        if (f.textContent) {
          const fence = `FILE_${Math.random().toString(36).slice(2, 10)}`;
          prompt += `\n\n[${f.name} content]\n${fence}\n${f.textContent}\n${fence}`;
        }
      }
    }

    // Agent respond
    const handle = bot.channel.sendStreaming(msg.chatId);
    const reply = await this.deps.agentFactory.respond(prompt, msg.chatId, {
      onText: (text) => handle.update(text),
      onToolStart: (info) => handle.updateToolStatus({ ...info, status: 'running' }),
      onToolEnd: (info) => handle.updateToolStatus({ ...info, status: 'complete', elapsedMs: info.elapsedMs }),
    });
    handle.finalize(reply);

    // Store reply
    this.deps.store.insert({
      id: `${msg.id}:reply`, chatId: msg.chatId,
      timestamp: Date.now(), text: reply, source: 'bot', botName: bot.name,
    });
    this.deps.bus.publish({ type: 'agent_reply_sent', botName: bot.name, chatId: msg.chatId, text: reply });
  }
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npx vitest run tests/bot.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: add BotManager with simple routing (no topology)"
```

---

### Task 8: Web Server

**Files:**
- Create: `src/web.ts`

**Source**: `bot-swarm/src/web.ts` 简化版。只保留 health + bot list + message history + event WebSocket。

- [ ] **Step 1: Implement web.ts**

```typescript
// src/web.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './logger.js';
import type { BotManager } from './bot.js';
import type { MessageStore } from './store.js';
import type { MessageBus } from './bus.js';

interface WebDeps {
  port: number;
  botManager: BotManager;
  store: MessageStore;
  bus: MessageBus;
}

export function startWebServer(deps: WebDeps) {
  const app = new Hono();
  app.use('*', cors());

  app.get('/api/health', (c) => c.json({ status: 'ok', bots: deps.botManager.listBots() }));

  app.get('/api/bots', (c) => c.json(deps.botManager.listBots()));

  app.get('/api/chats', (c) => c.json(deps.store.listChats()));

  app.get('/api/chats/:chatId/messages', (c) => {
    const msgs = deps.store.listMessages(c.req.param('chatId'));
    return c.json(msgs);
  });

  app.post('/api/admin/clear-messages', (c) => {
    const count = deps.store.clearAll();
    return c.json({ cleared: count });
  });

  // WebSocket for live events
  // (served via raw HTTP upgrade — see bot-swarm/web.ts for pattern)

  const server = (globalThis as any).__unifiedPlatformServer;
  if (!server) {
    // Simple start without WS upgrade (Phase 1)
    import('@hono/node-server').then(({ serve }) => {
      serve({ fetch: app.fetch, port: deps.port });
      logger.info({ port: deps.port }, 'Web server started');
    });
  }

  return {
    stop: async () => { /* close server */ },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web.ts
git commit -m "feat: add minimal web server (health, bots, chats, messages)"
```

---

### Task 9: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement index.ts**

```typescript
// src/index.ts
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { BotManager } from './bot.js';
import { ClaudeAgent } from './agent.js';
import { MessageStore } from './store.js';
import { MessageBus } from './bus.js';
import { DedupCache } from './dedup.js';
import { startWebServer } from './web.js';
import { FeishuChannel } from './feishu.js';
import type { ChannelAdapter } from './channel.js';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ bots: Object.keys(config.bots) }, 'Config loaded');

  const bus = new MessageBus();
  const store = new MessageStore(`${config.dataDir}/messages.db`);
  const dedup = new DedupCache();

  // Create channels
  const channels: Record<string, ChannelAdapter> = {};
  for (const [name, botConfig] of Object.entries(config.bots)) {
    if (botConfig.channel === 'feishu') {
      channels[name] = new FeishuChannel(botConfig);
    }
    // DingTalk: Phase 2
  }

  // Create agent factory (lazy per bot)
  const agents = new Map<string, ClaudeAgent>();
  const agentFactory = {
    respond: (prompt: string, chatId: string, opts?: any) => {
      // For simplicity, use the first bot's agent in Phase 1
      // In production, each bot gets its own agent
      const firstBot = Object.values(config.bots)[0];
      if (!firstBot) throw new Error('No bots configured');
      let agent = agents.get('default');
      if (!agent) {
        agent = new ClaudeAgent({ name: 'default', agentDir: firstBot.agentDir, cwd: firstBot.cwd, model: firstBot.model });
        agents.set('default', agent);
      }
      return agent.respond(prompt, chatId, opts);
    },
    clearSession: (chatId: string) => {
      const agent = agents.get('default');
      return agent?.clearSession(chatId) ?? false;
    },
  };

  const botManager = new BotManager({ config, agentFactory, bus, store, dedup });
  await botManager.start(channels);

  const web = startWebServer({ port: config.web.port, botManager, store, bus });
  logger.info({ ui: `http://localhost:${config.web.port}/` }, 'HappyCompany running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await web.stop();
    await botManager.stop();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point wiring all components together"
```

---

## Phase 2: DingTalk Channel

**目标**: 钉钉 Bot 收消息 → Claude 回复 → 流式卡片 → 文件处理（群聊中能看到文件）。

**源文件**: `workspace/20260414-happyclaw-research/src/dingtalk.ts` + `dingtalk-streaming-card.ts`

### Task 10: DingTalk Channel

**Files:**
- Create: `src/dingtalk.ts`
- Create: `src/dingtalk-card.ts`

- [ ] **Step 1: Extract DingTalkChannel from happycompany research**

Source: `workspace/20260414-happyclaw-research/src/dingtalk.ts`

关键适配：
1. 实现 `ChannelAdapter` 接口
2. `onMessage` 产出 `NormalizedMessage`
3. 文件消息 → `downloadFile` → `FileAttachment`
4. Reply 解析 → `NormalizedMessage.replyTo`
5. Ack reaction（thinking emoji）

- [ ] **Step 2: Extract DingTalkStreamingCard**

Source: `workspace/20260414-happyclaw-research/src/dingtalk-streaming-card.ts`

适配点：实现 `StreamingHandle` 接口。

- [ ] **Step 3: Wire DingTalkChannel in index.ts**

在 `src/index.ts` 中加 `import { DingTalkChannel } from './dingtalk.js'`，并在 channel 创建循环中加 `else if (botConfig.channel === 'dingtalk')`。

- [ ] **Step 4: Test with real DingTalk credentials**

- [ ] **Step 5: Commit**

---

## Phase 3: App / Skill System

**目标**: Skill 定义（SKILL.md frontmatter）→ App Registry → 版本管理 → 安装/更新 → Workdir 管理 → 群聊 desc 注入。

### Task 11: Skill Scanner

**Files:**
- Create: `src/skills.ts`

**Source**: `workspace/20260414-happyclaw-research/src/skill-utils.ts`

功能：
- 扫描目录下所有 SKILL.md 文件
- 解析 YAML frontmatter（id, name, description, allowed-tools, user-invocable）
- 返回 `SkillDef[]`

### Task 12: App Registry

**Files:**
- Create: `src/registry.ts`

功能：
- `registry.json` CRUD（读取、发布新版本、回滚）
- `listApps()`, `getApp(name, version)`, `publish(name, version, dir)`, `rollback(name, toVersion)`
- `install(appName, version, workdir)` — 复制 skill 文件到 workdir/.claude/skills/

### Task 13: Workdir Manager

**Files:**
- Create: `src/workdir.ts`

功能：
- 创建 workdir 结构（installed.json, CLAUDE.md, .claude/skills/, uploads/）
- 读取 installed.json
- 更新版本号

### Task 14: Group Chat Desc Injection

**Files:**
- Create: `src/desc.ts`

功能：
- 扫描所有 Bot 的 workdir CLAUDE.md
- 生成能力描述列表
- 注入到每个 Bot 的 session prompt 中（群聊场景）

---

## Phase 4: Admin Web UI

**目标**: React SPA 管理界面 — App 管理、Skill 管理、版本控制、使用统计。

### Task 15: Web Scaffold

- Vite + React 19 + Tailwind 4
- 路由：Dashboard / Apps / Skills / Stats / Settings

### Task 16: App Management Page

- App 列表（名称 + 版本号 + 状态）
- 查看 README.md（产品说明书）
- 编辑 App 代码（文件浏览器）
- 发布新版本

### Task 17: Skill Management Page

- 扫描显示所有 Skill
- 编辑 Skill 定义
- 安装/卸载 Skill 到 Workdir

### Task 18: Usage Dashboard

- 每个 Bot 的消息量趋势
- 每个 Skill 的调用次数
- 活跃用户数

---

## Phase 5: Analytics & Iteration

**目标**: AI 辅助迭代 — 从 session logs 提取洞察 → 生成改进建议 → 管理员审核。

### Task 19: Usage Statistics Collector

- 定期统计 skill 调用、成功率、用户反馈
- 写入 `data/analytics.db`

### Task 20: AI Insight Generator

- 读取 message-store 数据
- 调用 Claude API 生成改进建议
- 输出：改现有 / 新建 / 合并 / 下线

### Task 21: Iteration Proposal Flow

- 管理员查看 AI 建议
- 审核通过后自动生成 App 改动方案
- 管理员确认后执行

---

## Implementation Order & Dependencies

```
Phase 1 (Core Skeleton)
  Task 1 (setup) → Task 2 (types) → Task 3 (config) → Task 4 (infra) → Task 6 (agent)
                                                                     ↓
  Task 5 (feishu) ←──────────────────────────────────────────────────┘
      ↓
  Task 7 (bot) → Task 8 (web) → Task 9 (index)

Phase 2 (DingTalk)
  Task 10 (dingtalk channel + card + file handling)

Phase 3 (App/Skill)
  Task 11 (skill scanner) → Task 12 (registry) → Task 13 (workdir) → Task 14 (desc injection)

Phase 4 (Admin UI)
  Task 15 (scaffold) → Task 16 (apps) → Task 17 (skills) → Task 18 (dashboard)

Phase 5 (Analytics)
  Task 19 (collector) → Task 20 (AI insight) → Task 21 (iteration flow)
```
