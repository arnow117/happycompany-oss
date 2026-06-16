# User Bootstrap Wave 3: Complete Spec Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all remaining features from `docs/superpowers/specs/2026-05-22-user-bootstrap-design.md` — skill system simplification, employee collaboration, workdir incremental sync, and tenant export/save-as-template.

**Architecture:** Four independent subsystems, each producing working, testable software. Dependencies: Tasks 1-3 (skill-bridge) should land first since Task 6 (workdir sync) assumes SKILL.md tool extraction exists. Tasks 4-5 (collaboration) and Tasks 7-8 (export/template) are fully independent.

**Tech Stack:** TypeScript, Zod, Hono (routes), Node.js fs/path/archiver, Vitest

**Spec:** `docs/superpowers/specs/2026-05-22-user-bootstrap-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/tool-schemas.ts` | Add SkillToolDef Zod schema |
| Modify | `src/skills.ts` | Parse `tools:` from SKILL.md frontmatter |
| Modify | `src/workdir-scanner.ts` | Scan toolDefs, compute file hashes |
| Create | `src/skill-tool-builder.ts` | Build MCP tools from SKILL.md data |
| Modify | `src/orchestrator/skill-bridge.ts` | Fall back to SKILL.md tools |
| Modify | `src/index.ts` | Wire SkillToolBuilder |
| Create | `src/collaborate.ts` | Employee collaboration logic |
| Create | `src/routes/collaborate.ts` | `/internal/collaborate` API route |
| Create | `bin/collaborate` | CLI entry point for collaborate skill |
| Create | `src/workdir-sync.ts` | Incremental sync with hash comparison |
| Modify | `src/routes/workdir.ts` | Add `/api/workdir/sync` endpoint |
| Create | `src/tenant-export.ts` | Zip export logic |
| Create | `src/tenant-template-save.ts` | Save tenant as template |
| Modify | `src/routes/admin-tenants.ts` | Add export and save-as-template routes |
| Modify | `corp/acme/.claude/skills/med_crm/SKILL.md` | Migrate tool defs from tools.json |

---

## Part A: Skill-Bridge Refactor (Tasks 1-3)

> Spec section: "Skill 体系简化" (lines 344-358)

### Task 1: Add SKILL.md Tool Definition Schema + Parse from Frontmatter

**Files:**
- Modify: `src/tool-schemas.ts`
- Modify: `src/skills.ts`
- Modify: `src/workdir-scanner.ts`
- Create: `tests/tool-schemas.test.ts`
- Modify: `tests/workdir-scanner.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tool-schemas.test.ts
import { describe, it, expect } from 'vitest';
import { skillToolSchema, skillToolManifestSchema } from '../src/tool-schemas.js';

describe('skillToolSchema', () => {
  it('validates a read tool with parameters', () => {
    const result = skillToolSchema.safeParse({
      name: 'search_hospitals',
      description: 'Search hospitals',
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
      description: 'Add',
      riskLevel: 'internal_write',
      parameters: { type: 'object', properties: {} },
    });
    expect(result.success).toBe(true);
  });

  it('rejects tool without name', () => {
    const result = skillToolSchema.safeParse({
      description: 'No name',
      parameters: { type: 'object', properties: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('skillToolManifestSchema', () => {
  it('validates tools array', () => {
    const result = skillToolManifestSchema.safeParse({
      tools: [{ name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } }],
    });
    expect(result.success).toBe(true);
  });

  it('defaults to empty array', () => {
    const result = skillToolManifestSchema.parse({});
    expect(result.tools).toEqual([]);
  });
});
```

Add to `tests/workdir-scanner.test.ts` inside `describe('scan')`:

```typescript
it('should scan tool definitions from SKILL.md frontmatter', () => {
  const scanner = new WorkdirScanner();
  const skillsDir = path.join(testDir, '.claude', 'skills');
  const skillDir = path.join(skillsDir, 'crm');
  fs.mkdirSync(skillDir, { recursive: true });

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: crm
description: CRM operations
has-write-ops: true
packages: [pandas]
tools:
  - name:search_customers,description:Search customers,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add_customer,description:Add customer,riskLevel:internal_write,parameters:{"type":"object","properties":{"name":{"type":"string"}}}
---

# CRM Skill`);

  const result = scanner.scan(testDir);

  expect(result.skills).toHaveLength(1);
  expect(result.skills[0].toolDefs).toHaveLength(2);
  expect(result.skills[0].toolDefs?.[0].name).toBe('search_customers');
  expect(result.skills[0].toolDefs?.[0].riskLevel).toBe('read');
  expect(result.skills[0].toolDefs?.[1].name).toBe('add_customer');
  expect(result.skills[0].toolDefs?.[1].riskLevel).toBe('internal_write');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tool-schemas.test.ts tests/workdir-scanner.test.ts`
Expected: FAIL — exports and types don't exist

- [ ] **Step 3: Add Zod schemas to `src/tool-schemas.ts`**

After the existing `toolDefSchema` (around line 17):

```typescript
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

- [ ] **Step 4: Add frontmatter object-array parsing to `src/skills.ts`**

Add two helpers before `parseFrontmatter`:

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

Inside `parseFrontmatter`, after the list-values block and before returning the plain array, add:

```typescript
if (listValues.length > 0 && listValues.every(v => /^[a-zA-Z_]\w*:/.test(v))) {
  return listValues.map(item => {
    const obj: Record<string, unknown> = {};
    for (const part of splitRespectingBraces(item)) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const key = part.slice(0, colonIdx).trim();
        obj[key] = tryParseJsonValue(part.slice(colonIdx + 1).trim());
      }
    }
    return obj;
  });
}
```

- [ ] **Step 5: Add `toolDefs` to `ScannedSkill` and wire extraction**

In `src/workdir-scanner.ts`, add to the `ScannedSkill` interface:

```typescript
import { type SkillToolDef } from './tool-schemas.js';

// In ScannedSkill:
toolDefs?: SkillToolDef[];
```

In the skill scanning section, after dependency parsing:

```typescript
import { skillToolSchema, type SkillToolDef } from './tool-schemas.js';

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

Include `toolDefs` in the returned `ScannedSkill`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/tool-schemas.test.ts tests/workdir-scanner.test.ts`
Expected: PASS

- [ ] **Step 7: Run full suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/tool-schemas.ts src/skills.ts src/workdir-scanner.ts tests/tool-schemas.test.ts tests/workdir-scanner.test.ts
git commit -m "feat: SKILL.md tool definition schema + frontmatter parsing"
```

---

### Task 2: Create SkillToolBuilder

**Files:**
- Create: `src/skill-tool-builder.ts`
- Create: `tests/skill-tool-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skill-tool-builder.test.ts
import { describe, it, expect } from 'vitest';
import { SkillToolBuilder } from '../src/skill-tool-builder.js';
import type { SkillToolDef } from '../src/tool-schemas.js';

describe('SkillToolBuilder', () => {
  const builder = new SkillToolBuilder();

  describe('buildTool', () => {
    it('builds a namespaced tool', () => {
      const toolDef: SkillToolDef = {
        name: 'search',
        description: 'Search things',
        riskLevel: 'read',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      };
      const result = builder.buildTool(toolDef, 'my-app');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app:search');
      expect(result!.appName).toBe('my-app');
    });

    it('returns null for null input', () => {
      expect(builder.buildTool(null as unknown as SkillToolDef, 'app')).toBeNull();
    });
  });

  describe('buildToolsForSkill', () => {
    it('builds all tools', () => {
      const result = builder.buildToolsForSkill({
        appName: 'crm',
        toolDefs: [
          { name: 'search', description: 'Search', riskLevel: 'read', parameters: { type: 'object', properties: {} } },
          { name: 'add', description: 'Add', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
        ],
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('crm:search');
      expect(result[1].name).toBe('crm:add');
    });

    it('returns empty for no toolDefs', () => {
      expect(builder.buildToolsForSkill({ appName: 'x' })).toEqual([]);
      expect(builder.buildToolsForSkill({ appName: 'x', toolDefs: [] })).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/skill-tool-builder.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write implementation**

```typescript
// src/skill-tool-builder.ts
import type { SkillToolDef } from './tool-schemas.js';

export interface BuiltTool {
  name: string;
  description: string;
  riskLevel: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  appName: string;
}

export interface SkillToolSource {
  appName: string;
  toolDefs?: SkillToolDef[];
}

export class SkillToolBuilder {
  buildTool(toolDef: SkillToolDef, appName: string): BuiltTool | null {
    if (!toolDef?.name || !toolDef?.description) return null;
    return {
      name: `${appName}:${toolDef.name}`,
      description: toolDef.description,
      riskLevel: toolDef.riskLevel,
      parameters: toolDef.parameters,
      appName,
    };
  }

  buildToolsForSkill(source: SkillToolSource): BuiltTool[] {
    if (!source.toolDefs?.length) return [];
    return source.toolDefs
      .map(def => this.buildTool(def, source.appName))
      .filter((t): t is BuiltTool => t !== null);
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/skill-tool-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-tool-builder.ts tests/skill-tool-builder.test.ts
git commit -m "feat: SkillToolBuilder for SKILL.md-based tool resolution"
```

---

### Task 3: Wire SkillBridge + Migrate med_crm

**Files:**
- Modify: `src/orchestrator/skill-bridge.ts`
- Modify: `src/index.ts`
- Modify: `corp/acme/.claude/skills/med_crm/SKILL.md`
- Create: `tests/skill-bridge-skillmd.test.ts`

- [ ] **Step 1: Update SkillBridgeOptions**

In `src/orchestrator/skill-bridge.ts`, add to the options interface:

```typescript
import { SkillToolBuilder, type BuiltTool } from '../skill-tool-builder.js';

// In SkillBridgeOptions:
skillToolBuilder?: SkillToolBuilder;
```

- [ ] **Step 2: Add resolveToolsFromSkills method**

Add imports and the new private method:

```typescript
import { parseFrontmatter } from '../skills.js';
import { skillToolSchema, type SkillToolDef } from '../tool-schemas.js';

private resolveToolsFromSkills(app: EmployeeDefinition, tenantName: string): BuiltTool[] {
  if (!this.options.skillToolBuilder || !app.skills?.length) return [];

  const skillsDir = path.join(this.options.corpDir, tenantName, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const allTools: BuiltTool[] = [];
  for (const skillName of app.skills) {
    const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    const frontmatter = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf-8'));
    const toolsRaw = frontmatter['tools'];
    if (!Array.isArray(toolsRaw) || !toolsRaw.length) continue;

    const validatedDefs: SkillToolDef[] = toolsRaw
      .map((t: unknown) => skillToolSchema.safeParse(t))
      .filter((r: { success: boolean }) => r.success)
      .map((r: { success: true; data: SkillToolDef }) => r.data);

    allTools.push(...this.options.skillToolBuilder.buildToolsForSkill({ appName: skillName, toolDefs: validatedDefs }));
  }
  return allTools;
}
```

- [ ] **Step 3: Update resolveTools() to fall back**

Update `ResolvedTool` to a union type:

```typescript
type ResolvedTool =
  | { namespacedName: string; appName: string; matchedPattern: string; tool: RegisteredTool }
  | { namespacedName: string; appName: string; matchedPattern: string; builtTool: BuiltTool };
```

At the end of `resolveTools()`, before return:

```typescript
if (resolved.length === 0) {
  for (const bt of this.resolveToolsFromSkills(app, tenantName)) {
    resolved.push({ namespacedName: bt.name, appName: bt.appName, matchedPattern: `skill:${bt.appName}`, builtTool: bt });
  }
}
```

Update `buildSingleTool()` to check for `builtTool` field and handle it.

- [ ] **Step 4: Wire in `src/index.ts`**

```typescript
import { SkillToolBuilder } from './skill-tool-builder.js';

const skillToolBuilder = new SkillToolBuilder();
const skillBridge = new SkillBridge({ toolRegistry, appServerMgr, corpDir, writeLockManager, skillToolBuilder });
```

- [ ] **Step 5: Migrate med_crm SKILL.md**

Read `corp/acme/apps/med_crm/tools.json` to get all 9 tool definitions. Add them to `corp/acme/.claude/skills/med_crm/SKILL.md` frontmatter as `tools:` entries in comma-separated format. Keep `tools.json` for backward compatibility.

- [ ] **Step 6: Write integration test**

```typescript
// tests/skill-bridge-skillmd.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from '../src/workdir-scanner.js';
import { SkillToolBuilder } from '../src/skill-tool-builder.js';

describe('SKILL.md to tool integration', () => {
  let testDir: string;
  beforeEach(() => { testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'skill-int-')); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('scans and builds tools end-to-end', () => {
    const skillDir = path.join(testDir, '.claude', 'skills', 'crm');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: crm
description: CRM
tools:
  - name:search,description:Search,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add,description:Add,riskLevel:internal_write,parameters:{"type":"object","properties":{"d":{"type":"string"}}}
---

# CRM`);

    const scan = new WorkdirScanner().scan(testDir);
    expect(scan.skills[0].toolDefs).toHaveLength(2);

    const tools = new SkillToolBuilder().buildToolsForSkill({ appName: 'crm', toolDefs: scan.skills[0].toolDefs });
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('crm:search');
    expect(tools[1].name).toBe('crm:add');
  });

  it('handles SKILL.md without tools', () => {
    const skillDir = path.join(testDir, '.claude', 'skills', 'basic');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: basic\ndescription: Basic\n---\n\n# Basic`);

    const scan = new WorkdirScanner().scan(testDir);
    expect(scan.skills[0].toolDefs).toBeUndefined();
    expect(new SkillToolBuilder().buildToolsForSkill({ appName: 'basic', toolDefs: scan.skills[0].toolDefs })).toEqual([]);
  });
});
```

- [ ] **Step 7: Run full verification**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass, zero type errors

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/skill-bridge.ts src/index.ts corp/acme/.claude/skills/med_crm/SKILL.md tests/skill-bridge-skillmd.test.ts
git commit -m "feat: SkillBridge SKILL.md fallback + migrate med_crm"
```

---

## Part B: Employee Collaboration (Tasks 4-5)

> Spec section: "第二层：员工间协作（LLM 驱动）" (lines 385-424)

### Task 4: Create Collaboration Service + API Route

**Files:**
- Create: `src/collaborate.ts`
- Create: `src/routes/collaborate.ts`
- Modify: `src/orchestrator/employee-colony.ts`
- Modify: `src/web.ts`
- Create: `tests/collaborate.test.ts`

The collaborate feature lets one employee ask another employee for help. Minimum path: resolve target employee by ID or role → call `protocol.execute()` → return response text.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/collaborate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CollaborateService } from '../src/collaborate.js';

describe('CollaborateService', () => {
  describe('send', () => {
    it('resolves target by employee ID and returns response', async () => {
      const mockProtocol = {
        name: 'finance-agent',
        execute: vi.fn().mockResolvedValue({ text: '发票已开具', done: true, handoff: null }),
      };
      const employeeManager = {
        get: vi.fn().mockReturnValue({ app: { id: 'finance-agent', tenantName: 'acme' }, protocol: mockProtocol }),
        findByRole: vi.fn().mockReturnValue(undefined),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales-zhangsan',
        target: 'finance-agent',
        message: '客户要开票',
        mode: 'sync',
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe('发票已开具');
      expect(employeeManager.get).toHaveBeenCalledWith('finance-agent');
      expect(mockProtocol.execute).toHaveBeenCalledWith(
        '客户要开票',
        expect.objectContaining({ chatId: expect.stringContaining('collab:') }),
      );
    });

    it('returns error when target not found', async () => {
      const employeeManager = {
        get: vi.fn().mockReturnValue(undefined),
        findByRole: vi.fn().mockReturnValue(undefined),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales',
        target: 'nonexistent',
        message: 'help',
        mode: 'sync',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('resolves target by role name', async () => {
      const mockProtocol = {
        name: 'finance-wangwu',
        execute: vi.fn().mockResolvedValue({ text: 'done', done: true, handoff: null }),
      };
      const employeeManager = {
        get: vi.fn().mockReturnValue(undefined),
        findByRole: vi.fn().mockReturnValue({
          app: { id: 'finance-wangwu', tenantName: 'acme', role: 'finance' },
          protocol: mockProtocol,
        }),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales-zhangsan',
        target: 'finance',
        message: '审批合同',
        mode: 'sync',
      });

      expect(result.success).toBe(true);
      expect(employeeManager.findByRole).toHaveBeenCalledWith('finance');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collaborate.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write CollaborateService**

```typescript
// src/collaborate.ts
import type { EmployeeManager } from './orchestrator/employee-colony.js';

export interface CollaborateRequest {
  tenant: string;
  sourceEmployeeId: string;
  target: string;
  message: string;
  mode: 'sync' | 'async';
}

export interface CollaborateResult {
  success: boolean;
  reply?: string;
  error?: string;
}

export class CollaborateService {
  constructor(private readonly deps: { employeeManager: EmployeeManager }) {}

  async send(req: CollaborateRequest): Promise<CollaborateResult> {
    let employee = this.deps.employeeManager.get(req.target);

    if (!employee) {
      employee = this.deps.employeeManager.findByRole(req.target);
    }

    if (!employee) {
      return { success: false, error: `Employee '${req.target}' not found` };
    }

    const chatId = `collab:${req.sourceEmployeeId}->${employee.app.id}:${Date.now()}`;

    try {
      const response = await employee.protocol.execute(req.message, { chatId });
      return { success: true, reply: response.text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: `Collaboration failed: ${msg}` };
    }
  }
}
```

- [ ] **Step 4: Add `findByRole` to EmployeeManager**

In `src/orchestrator/employee-colony.ts`, add to `EmployeeManager`:

```typescript
findByRole(role: string): RegisteredEmployee | undefined {
  for (const emp of this.employees.values()) {
    if (emp.app.role === role) return emp;
  }
  return undefined;
}
```

- [ ] **Step 5: Create API route**

```typescript
// src/routes/collaborate.ts
import type { HonoApp } from '../web.js';
import { CollaborateService } from '../collaborate.js';

export function registerCollaborateRoutes(app: HonoApp, deps: any) {
  app.post('/internal/collaborate', async (c) => {
    const body = await c.req.json();
    const { tenant, sourceEmployeeId, target, message, mode } = body;

    if (!tenant || !sourceEmployeeId || !target || !message) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const service = new CollaborateService({ employeeManager: deps.employeeManager });
    const result = await service.send({ tenant, sourceEmployeeId, target, message, mode: mode || 'sync' });
    return c.json(result);
  });
}
```

- [ ] **Step 6: Register route in `src/web.ts`**

```typescript
import { registerCollaborateRoutes } from './routes/collaborate.js';

// After other route registrations:
registerCollaborateRoutes(app, deps);
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/collaborate.test.ts && npx tsc --noEmit`
Expected: PASS, zero type errors

- [ ] **Step 8: Commit**

```bash
git add src/collaborate.ts src/routes/collaborate.ts src/orchestrator/employee-colony.ts src/web.ts tests/collaborate.test.ts
git commit -m "feat: employee collaboration service + /internal/collaborate API"
```

---

### Task 5: Create `bin/collaborate` Skill + SKILL.md

**Files:**
- Create: `bin/collaborate`
- Create: `corp/acme/.claude/skills/collaborate/SKILL.md`

- [ ] **Step 1: Create collaborate SKILL.md**

```bash
mkdir -p corp/acme/.claude/skills/collaborate
```

Write `corp/acme/.claude/skills/collaborate/SKILL.md`:

```markdown
---
name: collaborate
description: 与团队其他数字员工协作。指定目标员工ID或角色名称，发送消息并获取回复。
has-write-ops: false
internal: true
---

# Collaborate

向目标员工发送协作消息。

## 用法

`bin/collaborate --target <employee_id_or_role> --message <text> [--mode sync|async]`

## 参数

- `--target`: 目标员工ID（如 finance-wangwu）或角色名（如 finance）
- `--message`: 消息内容
- `--mode`: sync（等待回复）或 async。默认 sync。
```

- [ ] **Step 2: Create `bin/collaborate` script**

```bash
mkdir -p bin
```

Write `bin/collaborate`:

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET=""
MESSAGE=""
MODE="sync"

while [[ $# -gt 0 ]]; do
  case $1 in
    --target) TARGET="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TARGET" || -z "$MESSAGE" ]]; then
  echo "Usage: bin/collaborate --target <id_or_role> --message <text> [--mode sync|async]" >&2
  exit 1
fi

TENANT="${TENANT:-acme}"
SOURCE="${SOURCE_EMPLOYEE:-unknown}"

curl -s -X POST "http://localhost:3100/internal/collaborate" \
  -H "Content-Type: application/json" \
  -d "{\"tenant\":\"${TENANT}\",\"sourceEmployeeId\":\"${SOURCE}\",\"target\":\"${TARGET}\",\"message\":\"${MESSAGE}\",\"mode\":\"${MODE}\"}"
```

```bash
chmod +x bin/collaborate
```

- [ ] **Step 3: Commit**

```bash
git add bin/collaborate corp/acme/.claude/skills/collaborate/
git commit -m "feat: bin/collaborate skill for employee-to-employee delegation"
```

---

## Part C: Workdir Incremental Sync (Task 6)

> Spec section: "持续同步" (lines 335-339)

### Task 6: Add `/api/workdir/sync` Endpoint

**Files:**
- Create: `src/workdir-sync.ts`
- Modify: `src/routes/workdir.ts`
- Create: `tests/workdir-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workdir-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirSyncService } from '../src/workdir-sync.js';
import { WorkdirScanner } from '../src/workdir-scanner.js';

describe('WorkdirSyncService', () => {
  let testDir: string;
  let syncDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'workdir-sync-'));
    syncDir = path.join(testDir, 'sync-state');
    fs.mkdirSync(syncDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function createSkill(workdir: string, name: string, desc: string) {
    const dir = path.join(workdir, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}`);
  }

  it('detects new skills on first sync', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'Test');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    const result = service.sync(workdir);

    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toBe('test-skill');
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('detects no changes on re-sync', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'Test');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);
    const result = service.sync(workdir);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('detects removed skills', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'old-skill', 'Old');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);

    fs.rmSync(path.join(workdir, '.claude', 'skills', 'old-skill'), { recursive: true, force: true });

    const result = service.sync(workdir);
    expect(result.removed).toContain('old-skill');
  });

  it('detects changed skills (hash mismatch)', () => {
    const workdir = path.join(testDir, 'project');
    createSkill(workdir, 'test-skill', 'V1');

    const service = new WorkdirSyncService(new WorkdirScanner(), syncDir);
    service.sync(workdir);

    // Modify
    const skillMd = path.join(workdir, '.claude', 'skills', 'test-skill', 'SKILL.md');
    fs.writeFileSync(skillMd, '---\nname: test-skill\ndescription: V2\n---\n\n# V2');

    const result = service.sync(workdir);
    expect(result.changed).toContain('test-skill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workdir-sync.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write implementation**

```typescript
// src/workdir-sync.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from './workdir-scanner.js';
import type { ScanResult } from './workdir-scanner.js';

export interface SyncResult {
  added: string[];
  removed: string[];
  changed: string[];
  scanResult: ScanResult;
}

interface SyncState {
  [skillName: string]: string;
}

export class WorkdirSyncService {
  private readonly stateFile: string;

  constructor(
    private readonly scanner: WorkdirScanner,
    syncDir: string,
  ) {
    this.stateFile = path.join(syncDir, 'workdir-sync.json');
  }

  sync(workdir: string): SyncResult {
    const scanResult = this.scanner.scan(workdir);
    const previousState = this.loadState();
    const currentState: SyncState = {};

    for (const skill of scanResult.skills) {
      const skillMdPath = path.join(skill.path, 'SKILL.md');
      currentState[skill.name] = this.hashFile(skillMdPath);
    }

    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];

    for (const [name, hash] of Object.entries(currentState)) {
      if (!previousState[name]) {
        added.push(name);
      } else if (previousState[name] !== hash) {
        changed.push(name);
      }
    }

    for (const name of Object.keys(previousState)) {
      if (!currentState[name]) {
        removed.push(name);
      }
    }

    this.saveState(currentState);

    return { added, removed, changed, scanResult };
  }

  private hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private loadState(): SyncState {
    if (!fs.existsSync(this.stateFile)) return {};
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
  }

  private saveState(state: SyncState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}
```

- [ ] **Step 4: Add route to `src/routes/workdir.ts`**

```typescript
import { WorkdirSyncService } from '../workdir-sync.js';

// New route:
app.post('/api/admin/workdir/sync', async (c) => {
  const { path: workdirPath, syncDir } = await c.req.json();

  if (!workdirPath) {
    return c.json({ error: 'path is required' }, 400);
  }

  const scanner = new WorkdirScanner();
  const syncDirResolved = syncDir || path.join(workdirPath, '.workdir-sync');
  const result = new WorkdirSyncService(scanner, syncDirResolved).sync(workdirPath);
  return c.json(result);
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/workdir-sync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workdir-sync.ts src/routes/workdir.ts tests/workdir-sync.test.ts
git commit -m "feat: workdir incremental sync with hash-based change detection"
```

---

## Part D: Tenant Export & Save-as-Template (Tasks 7-8)

> Spec section: "导出与模板保存" (lines 459-481)

### Task 7: Tenant Export API

**Files:**
- Create: `src/tenant-export.ts`
- Modify: `src/routes/admin-tenants.ts`
- Create: `tests/tenant-export.test.ts`

Uses `archiver` for zip creation.

- [ ] **Step 1: Install archiver if needed**

```bash
grep '"archiver"' package.json || npm install archiver && npm install -D @types/archiver
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/tenant-export.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TenantExporter } from '../src/tenant-export.js';

describe('TenantExporter', () => {
  let testDir: string;
  let tenantDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tenant-export-'));
    tenantDir = path.join(testDir, 'test-tenant');

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, '.claude', 'skills', 'test-skill'), { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify({ displayName: 'Test' }));
    fs.writeFileSync(path.join(tenantDir, 'roles.json'), JSON.stringify({ roles: {} }));
    fs.writeFileSync(path.join(tenantDir, 'people.json'), '{}');
    fs.writeFileSync(path.join(tenantDir, 'employees', 'agent1.yaml'), 'id: agent1\nrole: sales');
    fs.writeFileSync(path.join(tenantDir, '.claude', 'skills', 'test-skill', 'SKILL.md'), '---\nname: test\n---\n\n# Test');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('exports tenant as zip buffer', () => {
    const zipBuffer = new TenantExporter().exportTenant(tenantDir);
    expect(zipBuffer).toBeInstanceOf(Buffer);
    expect(zipBuffer.length).toBeGreaterThan(0);
  });

  it('zip contains required files', () => {
    const zipPath = path.join(testDir, 'output.zip');
    fs.writeFileSync(zipPath, new TenantExporter().exportTenant(tenantDir));

    const extractDir = path.join(testDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', zipPath, '-d', extractDir]);

    expect(fs.existsSync(path.join(extractDir, 'tenant-export.json'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'employees', 'agent1.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'roles.json'))).toBe(true);
  });

  it('tenant-export.json has metadata', () => {
    const zipPath = path.join(testDir, 'output.zip');
    fs.writeFileSync(zipPath, new TenantExporter().exportTenant(tenantDir));

    const extractDir = path.join(testDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir]);

    const meta = JSON.parse(fs.readFileSync(path.join(extractDir, 'tenant-export.json'), 'utf-8'));
    expect(meta.version).toBe('1.0.0');
    expect(meta.exportedAt).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tenant-export.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Write implementation**

```typescript
// src/tenant-export.ts
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';

export class TenantExporter {
  exportTenant(tenantDir: string): Promise<Buffer> {
    const tenantName = path.basename(tenantDir);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Metadata
      archive.append(JSON.stringify({
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        tenantName,
      }, null, 2), { name: 'tenant-export.json' });

      // Walk directory and add files
      this.walkDir(tenantDir, tenantDir, archive);
      archive.finalize();
    });
  }

  private walkDir(dir: string, baseDir: string, archive: archiver.Archiver): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, baseDir, archive);
      } else {
        const relativePath = path.relative(baseDir, fullPath);
        archive.file(fullPath, { name: relativePath });
      }
    }
  }
}
```

- [ ] **Step 5: Add route to `src/routes/admin-tenants.ts`**

```typescript
import { TenantExporter } from '../tenant-export.js';

// Add route:
app.get('/api/tenants/:id/export', async (c) => {
  const tenantId = c.req.param('id');
  const tenantDir = path.join(corpDir, tenantId);

  if (!fs.existsSync(tenantDir)) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const zipBuffer = await new TenantExporter().exportTenant(tenantDir);
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${tenantId}-export.zip"`,
    },
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/tenant-export.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tenant-export.ts src/routes/admin-tenants.ts tests/tenant-export.test.ts package.json package-lock.json
git commit -m "feat: tenant export as zip with metadata"
```

---

### Task 8: Save-as-Template API

**Files:**
- Create: `src/tenant-template-save.ts`
- Create: `tests/tenant-template-save.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tenant-template-save.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TenantTemplateSaver } from '../src/tenant-template-save.js';

describe('TenantTemplateSaver', () => {
  let testDir: string;
  let tenantDir: string;
  let templatesDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'template-save-'));
    tenantDir = path.join(testDir, 'corp', 'test-tenant');
    templatesDir = path.join(testDir, 'corp', 'templates', 'industries');

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });

    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify({ displayName: 'Test Corp' }));
    fs.writeFileSync(path.join(tenantDir, 'employees', 'sales-zhangsan.yaml'), `id: sales-zhangsan\nrole: sales\ndisplayName: 销售小张`);
    fs.writeFileSync(path.join(tenantDir, 'employees', 'finance-wangwu.yaml'), `id: finance-wangwu\nrole: finance\ndisplayName: 财务小王`);
    fs.writeFileSync(path.join(tenantDir, 'roles.json'), JSON.stringify({ roles: { sales: { displayName: '销售', tools: '*' } } }));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('saves tenant as template', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, { templateId: 'test-industry', templateName: '测试行业' });

    const dir = path.join(templatesDir, 'test-industry');
    expect(fs.existsSync(path.join(dir, 'template.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'roles.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'employees', 'sales.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'employees', 'finance.yaml'))).toBe(true);
  });

  it('generates valid template.json', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, { templateId: 'test-industry', templateName: '测试行业' });

    const tpl = JSON.parse(fs.readFileSync(path.join(templatesDir, 'test-industry', 'template.json'), 'utf-8'));
    expect(tpl.id).toBe('test-industry');
    expect(tpl.name).toBe('测试行业');
    expect(tpl.version).toBe('1.0.0');
    expect(tpl.employees).toHaveLength(2);
    expect(tpl.employees[0].role).toBe('sales');
  });

  it('strips tenant-specific names', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, { templateId: 'test-industry', templateName: '测试行业' });

    const sales = fs.readFileSync(path.join(templatesDir, 'test-industry', 'employees', 'sales.yaml'), 'utf-8');
    expect(sales).toContain('role: sales');
    expect(sales).not.toContain('zhangsan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tenant-template-save.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write implementation**

```typescript
// src/tenant-template-save.ts
import fs from 'node:fs';
import path from 'node:path';

export interface SaveTemplateOptions {
  templateId: string;
  templateName: string;
  description?: string;
}

export class TenantTemplateSaver {
  save(tenantDir: string, templatesDir: string, options: SaveTemplateOptions): void {
    const templateDir = path.join(templatesDir, options.templateId);
    const employeesDir = path.join(tenantDir, 'employees');

    fs.mkdirSync(path.join(templateDir, 'employees'), { recursive: true });

    const employeeFiles = fs.readdirSync(employeesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    const templateEmployees: Array<{ template: string; role: string }> = [];

    for (const file of employeeFiles) {
      const content = fs.readFileSync(path.join(employeesDir, file), 'utf-8');
      const role = this.extractRole(content);
      if (!role) continue;

      const cleaned = this.stripTenantSpecifics(content, role);
      const fileName = `${role}.yaml`;

      fs.writeFileSync(path.join(templateDir, 'employees', fileName), cleaned);
      templateEmployees.push({ template: `employees/${fileName}`, role });
    }

    // Copy roles.json
    const rolesPath = path.join(tenantDir, 'roles.json');
    if (fs.existsSync(rolesPath)) {
      fs.writeFileSync(path.join(templateDir, 'roles.json'), fs.readFileSync(rolesPath, 'utf-8'));
    }

    // Generate template.json
    const template = {
      id: options.templateId,
      name: options.templateName,
      description: options.description || `从 ${path.basename(tenantDir)} 导出`,
      version: '1.0.0',
      employees: templateEmployees,
      ...(fs.existsSync(rolesPath) ? { defaultRoles: 'roles.json' } : {}),
    };

    fs.writeFileSync(path.join(templateDir, 'template.json'), JSON.stringify(template, null, 2));
  }

  private extractRole(yaml: string): string | null {
    const m = yaml.match(/^role:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  }

  private stripTenantSpecifics(content: string, role: string): string {
    return content
      .replace(/^id:.*$/m, `id: ${role}`)
      .replace(/^displayName:.*$/m, '')
      .replace(/\n{3,}/g, '\n\n');
  }
}
```

- [ ] **Step 4: Add route to `src/routes/admin-tenants.ts`**

```typescript
import { TenantTemplateSaver } from '../tenant-template-save.js';

app.post('/api/tenants/:id/save-as-template', async (c) => {
  const tenantId = c.req.param('id');
  const { templateId, templateName, description } = await c.req.json();

  if (!templateId || !templateName) {
    return c.json({ error: 'templateId and templateName required' }, 400);
  }

  const tenantDir = path.join(corpDir, tenantId);
  if (!fs.existsSync(tenantDir)) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  new TenantTemplateSaver().save(tenantDir, path.join(corpDir, 'templates', 'industries'), { templateId, templateName, description });
  return c.json({ success: true, templateId });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/tenant-template-save.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tenant-template-save.ts src/routes/admin-tenants.ts tests/tenant-template-save.test.ts
git commit -m "feat: save tenant as industry template"
```

---

## Part E: Cleanup + Final Verification (Task 9)

### Task 9: Cleanup and Full Verification

- [ ] **Step 1: Delete App.tsx.bak**

```bash
rm web/src/App.tsx.bak
```

- [ ] **Step 2: Add agents/web-bot/ to .gitignore**

Add to `.gitignore`:

```
agents/web-bot/
```

- [ ] **Step 3: Run full backend test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 5: Run frontend build**

Run: `cd web && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Run frontend type check**

Run: `cd web && npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 7: Commit cleanup**

```bash
git add .gitignore
git rm web/src/App.tsx.bak
git commit -m "chore: remove App.tsx.bak, gitignore agents/web-bot"
```
