# Skill-Bridge Refactor: Remove tools.json Dependency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tools.json-based tool registration with a SKILL.md-only protocol, so employees get their capabilities directly from SKILL.md frontmatter + bin/ scripts.

**Architecture:** The current flow is `tools.json → ToolRegistry → SkillBridge → MCP tools`. The new flow is `SKILL.md → SkillScanner → SkillBridge → MCP tools`. ToolRegistry is replaced by a SkillScanner that reads SKILL.md frontmatter for tool definitions. SkillBridge.resolveTools() switches from looking up RegisteredTool objects to building tools from SKILL.md data.

**Tech Stack:** TypeScript, Zod (validation), Node.js fs, Vitest (testing)

---

## Scope

This plan covers the first subsystem of the user bootstrap spec (spec section "Skill 体系简化"):
- Remove tools.json as the tool definition source
- Read tool definitions from SKILL.md frontmatter
- Update SkillBridge to work with SKILL.md-sourced tools
- Keep backward compatibility during transition (tools.json still works if present)

## Files

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/skill-tool-builder.ts` | Builds MCP tool definitions from SKILL.md data |
| Modify | `src/orchestrator/skill-bridge.ts` | Use SkillToolBuilder instead of ToolRegistry |
| Modify | `src/skills.ts` | Add tool definition extraction from SKILL.md frontmatter |
| Modify | `src/workdir-scanner.ts` | Scan tool definitions during workdir scan |
| Modify | `src/tool-schemas.ts` | Add SKILL.md tool definition Zod schema |
| Create | `tests/skill-tool-builder.test.ts` | Unit tests for tool builder |
| Modify | `tests/workdir-scanner.test.ts` | Update scan tests for tool definitions |
| Modify | `src/orchestrator/employee-colony.ts` | Update SkillBridge constructor call |

---

### Task 1: Add SKILL.md Tool Definition Schema

**Files:**
- Modify: `src/tool-schemas.ts`
- Create: `tests/tool-schemas.test.ts`

The spec says SKILL.md frontmatter can declare tools directly. We add a Zod schema for this.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tool-schemas.test.ts
import { describe, it, expect } from 'vitest';
import { skillToolSchema, skillToolManifestSchema } from '../src/tool-schemas.js';

describe('skillToolSchema', () => {
  it('validates a minimal read tool', () => {
    const result = skillToolSchema.safeParse({
      name: 'search_hospitals',
      description: 'Search hospitals by keyword',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
        required: ['keyword'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('defaults riskLevel to read', () => {
    const result = skillToolSchema.parse({
      name: 'search',
      description: 'Search',
      parameters: { type: 'object', properties: {} },
    });
    expect(result.riskLevel).toBe('read');
  });

  it('validates a write tool', () => {
    const result = skillToolSchema.safeParse({
      name: 'add_record',
      description: 'Add a record',
      riskLevel: 'internal_write',
      parameters: { type: 'object', properties: { data: { type: 'string' } } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects tool without name', () => {
    const result = skillToolSchema.safeParse({
      description: 'Missing name',
      parameters: { type: 'object', properties: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('skillToolManifestSchema', () => {
  it('validates tools array in frontmatter', () => {
    const result = skillToolManifestSchema.safeParse({
      tools: [
        {
          name: 'search',
          description: 'Search things',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.tools).toHaveLength(1);
  });

  it('allows empty tools array', () => {
    const result = skillToolManifestSchema.safeParse({ tools: [] });
    expect(result.success).toBe(true);
  });

  it('defaults to empty tools array', () => {
    const result = skillToolManifestSchema.parse({});
    expect(result.tools).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-schemas.test.ts`
Expected: FAIL — `skillToolSchema` and `skillToolManifestSchema` do not exist

- [ ] **Step 3: Write minimal implementation**

Add to `src/tool-schemas.ts`, after the existing `toolDefSchema` (around line 17):

```typescript
// SKILL.md frontmatter tool definitions (replaces tools.json dependency)
export const skillToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  riskLevel: riskLevelSchema.default('read'),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export const skillToolManifestSchema = z.object({
  tools: z.array(skillToolSchema).default([]),
});

export type SkillToolDef = z.infer<typeof skillToolSchema>;
export type SkillToolManifest = z.infer<typeof skillToolManifestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/tool-schemas.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/tool-schemas.ts tests/tool-schemas.test.ts
git commit -m "feat: add SKILL.md tool definition Zod schemas"
```

---

### Task 2: Extract Tool Definitions from SKILL.md Frontmatter

**Files:**
- Modify: `src/skills.ts`
- Modify: `src/workdir-scanner.ts`
- Modify: `tests/workdir-scanner.test.ts`

We need `scanSkillDirectory()` and the workdir scanner to extract tool definitions from SKILL.md frontmatter when a `tools:` field is present.

- [ ] **Step 1: Write the failing test**

Add to `tests/workdir-scanner.test.ts`, inside the `describe('scan')` block, after the last test:

```typescript
it('should scan tool definitions from SKILL.md frontmatter', () => {
  const scanner = new WorkdirScanner();
  const skillsDir = path.join(testDir, '.claude', 'skills');
  const skillDir = path.join(skillsDir, 'crm');
  fs.mkdirSync(skillDir, { recursive: true });

  const skillMdPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillMdPath, `---
name: crm
description: CRM operations
has-write-ops: true
packages: [pandas]
tools:
  - name:search_customers,description:Search customers,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add_customer,description:Add new customer,riskLevel:internal_write,parameters:{"type":"object","properties":{"name":{"type":"string"}}}
---

# CRM Skill

Customer management tools.`);

  const result = scanner.scan(testDir);

  expect(result.skills).toHaveLength(1);
  expect(result.skills[0].name).toBe('crm');
  expect(result.skills[0].toolDefs).toHaveLength(2);
  expect(result.skills[0].toolDefs?.[0].name).toBe('search_customers');
  expect(result.skills[0].toolDefs?.[0].riskLevel).toBe('read');
  expect(result.skills[0].toolDefs?.[1].name).toBe('add_customer');
  expect(result.skills[0].toolDefs?.[1].riskLevel).toBe('internal_write');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/workdir-scanner.test.ts`
Expected: FAIL — `toolDefs` does not exist on `ScannedSkill`

- [ ] **Step 3: Update the ScannedSkill type**

In `src/workdir-scanner.ts`, add `toolDefs` to the `ScannedSkill` interface (around line 14):

```typescript
import { type SkillToolDef } from './tool-schemas.js';

export interface ScannedSkill {
  name: string;
  description: string;
  path: string;
  dependencies?: SkillDependencies;
  hasWriteOps: boolean;
  toolDefs?: SkillToolDef[];
}
```

Then in `src/skills.ts`, update `SkillInfo` interface (around line 14) to add:

```typescript
toolDefs?: import('./tool-schemas.js').SkillToolDef[];
```

- [ ] **Step 4: Update parseFrontmatter to handle tools array**

In `src/skills.ts`, the `parseFrontmatter` function needs to handle `tools:` as an array of objects. The current parser handles `packages: [a, b]` bracket arrays and `- item` list arrays. For `tools:`, each list item is a comma-separated key:value string like `name:search,description:Search`.

The existing `parseFrontmatter` already handles `- item` lists. When the value for `tools` is a list, each `- ` line should be parsed as a comma-separated key:value map.

Add two helper functions before `parseFrontmatter` in `src/skills.ts`:

```typescript
function splitRespectingBraces(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') depth++;
    else if (s[i] === '}' || s[i] === ']') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += s[i];
  }
  if (current) parts.push(current);
  return parts;
}

function tryParseJsonValue(val: string): unknown {
  if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
    try { return JSON.parse(val); } catch { return val; }
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  return val;
}
```

Then inside `parseFrontmatter`, after the existing list item collection block (where list items are collected into `listValues`), add detection for comma-separated key:value items before returning the plain string array:

```typescript
// If all list items match "key:value" pattern, parse as object array
if (listValues.length > 0 && listValues.every(v => /^[a-zA-Z_]\w*:/.test(v))) {
  const objects = listValues.map(item => {
    const obj: Record<string, unknown> = {};
    const parts = splitRespectingBraces(item);
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const key = part.slice(0, colonIdx).trim();
        const val = part.slice(colonIdx + 1).trim();
        obj[key] = tryParseJsonValue(val);
      }
    }
    return obj;
  });
  return objects;
}
```

- [ ] **Step 5: Wire tool definitions into workdir scanner**

In `src/workdir-scanner.ts`, in the skill scanning section where it parses SKILL.md frontmatter, add tool definition extraction after the existing dependency parsing:

```typescript
import { skillToolSchema, type SkillToolDef } from './tool-schemas.js';

// After parsing dependencies from frontmatter:
const toolsRaw = frontmatter['tools'];
let toolDefs: SkillToolDef[] | undefined;
if (Array.isArray(toolsRaw) && toolsRaw.length > 0) {
  toolDefs = toolsRaw
    .map((t: unknown) => skillToolSchema.safeParse(t))
    .filter((r: { success: boolean }) => r.success)
    .map((r: { success: true; data: SkillToolDef }) => r.data);
  if (toolDefs.length === 0) toolDefs = undefined;
}
```

Then include `toolDefs` in the returned `ScannedSkill` object.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/workdir-scanner.test.ts`
Expected: PASS

- [ ] **Step 7: Run full backend test suite**

Run: `cd /workspace/happycompany && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add src/workdir-scanner.ts src/skills.ts tests/workdir-scanner.test.ts
git commit -m "feat: extract tool definitions from SKILL.md frontmatter"
```

---

### Task 3: Create SkillToolBuilder

**Files:**
- Create: `src/skill-tool-builder.ts`
- Create: `tests/skill-tool-builder.test.ts`

This new module replaces the ToolRegistry-to-SkillBridge pipeline for SKILL.md-sourced tools. It takes parsed SKILL.md tool definitions and builds normalized tool objects.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skill-tool-builder.test.ts
import { describe, it, expect } from 'vitest';
import { SkillToolBuilder } from '../src/skill-tool-builder.js';
import type { SkillToolDef } from '../src/tool-schemas.js';

describe('SkillToolBuilder', () => {
  const builder = new SkillToolBuilder();

  describe('buildTool', () => {
    it('builds a namespaced tool from a tool definition', () => {
      const toolDef: SkillToolDef = {
        name: 'search',
        description: 'Search things',
        riskLevel: 'read',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      };

      const result = builder.buildTool(toolDef, 'my-app');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app:search');
      expect(result!.description).toBe('Search things');
      expect(result!.riskLevel).toBe('read');
      expect(result!.appName).toBe('my-app');
    });

    it('builds a write tool', () => {
      const toolDef: SkillToolDef = {
        name: 'add_record',
        description: 'Add a record',
        riskLevel: 'internal_write',
        parameters: { type: 'object', properties: {} },
      };

      const result = builder.buildTool(toolDef, 'crm');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('crm:add_record');
      expect(result!.riskLevel).toBe('internal_write');
    });

    it('returns null for null input', () => {
      const result = builder.buildTool(null as unknown as SkillToolDef, 'app');
      expect(result).toBeNull();
    });
  });

  describe('buildToolsForSkill', () => {
    it('builds all tools for a skill with toolDefs', () => {
      const result = builder.buildToolsForSkill({
        appName: 'crm',
        toolDefs: [
          {
            name: 'search',
            description: 'Search',
            riskLevel: 'read',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'add',
            description: 'Add',
            riskLevel: 'internal_write',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('crm:search');
      expect(result[1].name).toBe('crm:add');
    });

    it('returns empty array for skill with no toolDefs', () => {
      const result = builder.buildToolsForSkill({
        appName: 'basic',
        toolDefs: undefined,
      });

      expect(result).toEqual([]);
    });

    it('returns empty array for skill with empty toolDefs', () => {
      const result = builder.buildToolsForSkill({
        appName: 'basic',
        toolDefs: [],
      });

      expect(result).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/happycompany && npx vitest run tests/skill-tool-builder.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/skill-tool-builder.ts
import type { SkillToolDef } from './tool-schemas.js';

export interface BuiltTool {
  name: string;
  description: string;
  riskLevel: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  appName: string;
}

export interface SkillToolSource {
  appName: string;
  toolDefs?: SkillToolDef[];
}

export class SkillToolBuilder {
  buildTool(toolDef: SkillToolDef, appName: string): BuiltTool | null {
    if (!toolDef || !toolDef.name || !toolDef.description) {
      return null;
    }

    return {
      name: `${appName}:${toolDef.name}`,
      description: toolDef.description,
      riskLevel: toolDef.riskLevel,
      parameters: toolDef.parameters,
      appName,
    };
  }

  buildToolsForSkill(source: SkillToolSource): BuiltTool[] {
    if (!source.toolDefs || source.toolDefs.length === 0) {
      return [];
    }

    return source.toolDefs
      .map(def => this.buildTool(def, source.appName))
      .filter((t): t is BuiltTool => t !== null);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/happycompany && npx vitest run tests/skill-tool-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-tool-builder.ts tests/skill-tool-builder.test.ts
git commit -m "feat: add SkillToolBuilder for SKILL.md-based tool resolution"
```

---

### Task 4: Update SkillBridge to Use SkillToolBuilder

**Files:**
- Modify: `src/orchestrator/skill-bridge.ts`
- Modify: `src/index.ts`

The SkillBridge currently depends on ToolRegistry. We add a fallback path that reads from SKILL.md tool definitions when ToolRegistry has no tools for the tenant.

- [ ] **Step 1: Read current SkillBridge code**

Read `src/orchestrator/skill-bridge.ts` fully to understand the current `SkillBridgeOptions`, `resolveTools()`, and `buildSingleTool()` methods.

- [ ] **Step 2: Update SkillBridgeOptions to accept SkillToolBuilder**

In `src/orchestrator/skill-bridge.ts`, add `skillToolBuilder` as an optional dependency to the `SkillBridgeOptions` interface:

```typescript
import { SkillToolBuilder, type BuiltTool } from '../skill-tool-builder.js';

interface SkillBridgeOptions {
  toolRegistry: ToolRegistry;
  appServerMgr: AppServerMgr;
  corpDir: string;
  writeLockManager?: WriteLockManager;
  skillToolBuilder?: SkillToolBuilder;
}
```

- [ ] **Step 3: Add SKILL.md-based tool resolution method**

Add a new private method to `SkillBridge`:

```typescript
private resolveToolsFromSkills(
  app: EmployeeDefinition,
  tenantName: string,
): BuiltTool[] {
  if (!this.options.skillToolBuilder || !app.skills || app.skills.length === 0) {
    return [];
  }

  const tenantDir = path.join(this.options.corpDir, tenantName);
  const skillsDir = path.join(tenantDir, '.claude', 'skills');

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const allTools: BuiltTool[] = [];

  for (const skillName of app.skills) {
    const skillDir = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const toolsRaw = frontmatter['tools'];

    if (!Array.isArray(toolsRaw) || toolsRaw.length === 0) continue;

    const { skillToolSchema } = require('../tool-schemas.js');
    const validatedDefs = toolsRaw
      .map((t: unknown) => skillToolSchema.safeParse(t))
      .filter((r: { success: boolean }) => r.success)
      .map((r: { success: true; data: SkillToolDef }) => r.data);

    const built = this.options.skillToolBuilder.buildToolsForSkill({
      appName: skillName,
      toolDefs: validatedDefs,
    });

    allTools.push(...built);
  }

  return allTools;
}
```

Note: requires adding `import { parseFrontmatter } from '../skills.js';` and `import { skillToolSchema, type SkillToolDef } from '../tool-schemas.js';` at the top.

- [ ] **Step 4: Update resolveTools() to fall back to SKILL.md tools**

In `resolveTools()`, at the end before the return, add fallback logic when ToolRegistry found nothing:

```typescript
// If ToolRegistry found no tools for this tenant, try SKILL.md-based resolution
if (resolved.length === 0) {
  const skillTools = this.resolveToolsFromSkills(app, tenantName);
  for (const bt of skillTools) {
    resolved.push({
      namespacedName: bt.name,
      appName: bt.appName,
      matchedPattern: `skill:${bt.appName}`,
      tool: bt,
    });
  }
}
```

Note: The `resolved` array element type (`ResolvedTool`) may need updating to accept a `BuiltTool` in a `builtTool` field. Check the current `ResolvedTool` type in skill-bridge.ts and extend it with a union:

```typescript
type ResolvedTool =
  | { namespacedName: string; appName: string; matchedPattern: string; tool: RegisteredTool }
  | { namespacedName: string; appName: string; matchedPattern: string; builtTool: BuiltTool };
```

- [ ] **Step 5: Update buildSingleTool() to handle BuiltTool**

In `buildSingleTool()`, add a check for the new `builtTool` field:

```typescript
if ('builtTool' in resolved && resolved.builtTool) {
  const bt = resolved.builtTool;
  // Build MCP tool definition from BuiltTool
  // Use the same jsonSchemaToZodShape() conversion for parameters
  // Apply write-lock check for internal_write/destructive riskLevel
  return /* SdkMcpToolDefinition built from bt */;
}
// else: existing RegisteredTool path unchanged
```

- [ ] **Step 6: Wire SkillToolBuilder in index.ts**

In `src/index.ts`, where `SkillBridge` is constructed (around line 186), add the builder:

```typescript
import { SkillToolBuilder } from './skill-tool-builder.js';

const skillToolBuilder = new SkillToolBuilder();

const skillBridge = new SkillBridge({
  toolRegistry,
  appServerMgr,
  corpDir,
  writeLockManager,
  skillToolBuilder,
});
```

- [ ] **Step 7: Run TypeScript type check**

Run: `cd /workspace/happycompany && npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 8: Run full backend test suite**

Run: `cd /workspace/happycompany && npx vitest run`
Expected: All existing tests pass (backward compatible — only activates when no tools.json tools found)

- [ ] **Step 9: Commit**

```bash
git add src/orchestrator/skill-bridge.ts src/index.ts
git commit -m "feat: SkillBridge falls back to SKILL.md tool definitions"
```

---

### Task 5: Migrate med_crm tools.json to SKILL.md

**Files:**
- Modify: `corp/acme/.claude/skills/med_crm/SKILL.md`

The only tools.json in production. We add the tool definitions into the existing SKILL.md frontmatter so the new path works.

- [ ] **Step 1: Read current SKILL.md and tools.json**

Read `corp/acme/.claude/skills/med_crm/SKILL.md` for current frontmatter.
Read `corp/acme/apps/med_crm/tools.json` for the 9 tool definitions.

- [ ] **Step 2: Add tools to SKILL.md frontmatter**

Add each tool from tools.json as a frontmatter `tools:` entry. The format uses comma-separated key:value with JSON for nested `parameters`:

```yaml
---
name: med_crm
description: 医疗器械 CRM 操作
has-write-ops: true
packages: [pandas, requests]
tools:
  - name:search_hospitals,description:按关键词搜索医院客户信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:search_devices,description:搜索设备信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:list_maintenance,description:列出维保合同,riskLevel:read,parameters:{"type":"object","properties":{"hospital":{"type":"string"}}}
  - name:search_bids,description:搜索中标信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:add_sales_activity,description:新增销售活动记录,riskLevel:internal_write,parameters:{"type":"object","properties":{"type":{"type":"string"},"content":{"type":"string"}},"required":["type","content"]}
  - name:add_contact,description:新增联系人,riskLevel:internal_write,parameters:{"type":"object","properties":{"hospital":{"type":"string"},"name":{"type":"string"}},"required":["hospital","name"]}
  - name:add_incident,description:新增设备事件,riskLevel:internal_write,parameters:{"type":"object","properties":{"device":{"type":"string"},"description":{"type":"string"}},"required":["device","description"]}
  - name:global_search,description:全局搜索,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:hospital_info,description:获取医院详细信息,riskLevel:read,parameters:{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}
---

(rest of SKILL.md body unchanged)
```

Note: `tools.json` is kept in place for backward compatibility. Once the SkillBridge migration is verified in production, it can be removed.

- [ ] **Step 3: Verify the migration works**

Run: `cd /workspace/happycompany && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add corp/acme/.claude/skills/med_crm/SKILL.md
git commit -m "feat: migrate med_crm tool definitions from tools.json to SKILL.md"
```

---

### Task 6: Add Integration Test for Full Skill-to-MCP Flow

**Files:**
- Create: `tests/skill-bridge-skillmd.test.ts`

Verify the complete flow: SKILL.md with tools → WorkdirScanner → SkillToolBuilder → BuiltTool[].

- [ ] **Step 1: Write the integration test**

```typescript
// tests/skill-bridge-skillmd.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from '../src/workdir-scanner.js';
import { SkillToolBuilder } from '../src/skill-tool-builder.js';

describe('SKILL.md to MCP tool integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'skill-integration-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('scans SKILL.md with tools and builds tool definitions', () => {
    const skillsDir = path.join(testDir, '.claude', 'skills', 'crm');
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), `---
name: crm
description: CRM tool
has-write-ops: true
tools:
  - name:search,description:Search records,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add,description:Add record,riskLevel:internal_write,parameters:{"type":"object","properties":{"data":{"type":"string"}}}
---

# CRM
`);

    const scanner = new WorkdirScanner();
    const scanResult = scanner.scan(testDir);

    expect(scanResult.skills).toHaveLength(1);
    expect(scanResult.skills[0].toolDefs).toHaveLength(2);

    const builder = new SkillToolBuilder();
    const tools = builder.buildToolsForSkill({
      appName: 'crm',
      toolDefs: scanResult.skills[0].toolDefs,
    });

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('crm:search');
    expect(tools[0].riskLevel).toBe('read');
    expect(tools[1].name).toBe('crm:add');
    expect(tools[1].riskLevel).toBe('internal_write');
  });

  it('handles SKILL.md without tools gracefully', () => {
    const skillsDir = path.join(testDir, '.claude', 'skills', 'simple');
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), `---
name: simple
description: A simple skill
---

# Simple
`);

    const scanner = new WorkdirScanner();
    const scanResult = scanner.scan(testDir);

    expect(scanResult.skills).toHaveLength(1);
    expect(scanResult.skills[0].toolDefs).toBeUndefined();

    const builder = new SkillToolBuilder();
    const tools = builder.buildToolsForSkill({
      appName: 'simple',
      toolDefs: scanResult.skills[0].toolDefs,
    });

    expect(tools).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /workspace/happycompany && npx vitest run tests/skill-bridge-skillmd.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/skill-bridge-skillmd.test.ts
git commit -m "test: add integration test for SKILL.md to MCP tool flow"
```

---

### Task 7: Cleanup — Delete App.tsx.bak and Handle Untracked Files

**Files:**
- Delete: `web/src/App.tsx.bak`
- Modify: `.gitignore`

- [ ] **Step 1: Delete the backup file**

```bash
rm web/src/App.tsx.bak
```

- [ ] **Step 2: Add agents/web-bot/ to .gitignore**

Read `.gitignore`, check if `agents/` is already ignored. If not, add:

```
agents/web-bot/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git rm web/src/App.tsx.bak
git commit -m "chore: remove App.tsx.bak, gitignore agents/web-bot"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd /workspace/happycompany && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /workspace/happycompany && npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Run frontend build**

Run: `cd /workspace/happycompany/web && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Run frontend type check**

Run: `cd /workspace/happycompany/web && npx tsc --noEmit`
Expected: Zero errors
