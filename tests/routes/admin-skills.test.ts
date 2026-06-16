import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAdminSkillsRoutes } from '../../src/routes/admin-skills.js';
import type { BotInfo, BotManager } from '../../src/bot.js';
import type { SkillInfo } from '../../src/skills.js';

interface TestCtx {
  root: string;
  app: Hono;
}

function createSkill(root: string, name: string, description: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: ${description}
---

# ${name}
`, 'utf-8');
}

function makeBotManager(bots: BotInfo[] = []): BotManager {
  return {
    getBotInfos: () => bots,
  } as Pick<BotManager, 'getBotInfos'> as BotManager;
}

function setup(): TestCtx {
  const root = mkdtempSync(join(tmpdir(), 'admin-skills-routes-'));
  const skillsDir = join(root, 'data', 'skills');
  const corpDir = join(root, 'corp');
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(corpDir, { recursive: true });

  const app = new Hono();
  registerAdminSkillsRoutes(app, {
    skillsDir,
    botManager: makeBotManager(),
    corpDir,
  });

  return { root, app };
}

describe('admin skill routes', () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('lists skills from the requested tenant shared skill directory', async () => {
    createSkill(
      join(ctx.root, 'corp', 'tenant-a', '.claude', 'skills'),
      'med_crm',
      'Tenant CRM skill',
    );
    createSkill(
      join(ctx.root, 'corp', 'tenant-b', '.claude', 'skills'),
      'finance_ops',
      'Other tenant skill',
    );

    const res = await ctx.app.request('/api/admin/skills?tenant=tenant-a');

    expect(res.status).toBe(200);
    const body = await res.json() as SkillInfo[];
    expect(body.map((skill) => skill.id)).toContain('med_crm');
    expect(body.map((skill) => skill.id)).not.toContain('finance_ops');
    expect(body.find((skill) => skill.id === 'med_crm')?.source).toBe('tenant:tenant-a');
  });

  it('rejects invalid tenant names', async () => {
    const res = await ctx.app.request('/api/admin/skills?tenant=../tenant-a');

    expect(res.status).toBe(400);
  });
});
