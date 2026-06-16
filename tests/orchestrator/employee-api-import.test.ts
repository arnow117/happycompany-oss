import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEmployeeRoutes } from '../../src/orchestrator/employee-api.js';
import { EmployeeManager } from '../../src/orchestrator/employee-colony.js';
import { SkillBridge } from '../../src/orchestrator/skill-bridge.js';
import { SkillFactory } from '../../src/orchestrator/skill-factory.js';
import type { EmployeeGenerator } from '../../src/orchestrator/employee-generator.js';
import type { ClaudeAgent } from '../../src/agent.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'employee-api-import-'));
}

function writeFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('employee import API', () => {
  let tmpDir: string;
  let app: Hono;
  let manager: EmployeeManager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    manager = new EmployeeManager({
      corpDir: tmpDir,
      dataDir: path.join(tmpDir, '.data'),
      skillBridge: new SkillBridge(tmpDir),
      createAgent: vi.fn(() => ({ respond: vi.fn() }) as unknown as ClaudeAgent),
    });

    app = new Hono();
    registerEmployeeRoutes(app, {
      corpDir: tmpDir,
      tenant: 'target',
      employeeManager: manager,
      skillFactory: new SkillFactory(tmpDir),
      generator: {
        summarizeTools: vi.fn(() => ''),
        summarizeSkills: vi.fn(() => ''),
      } as unknown as EmployeeGenerator,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports employees from an external tenant-shaped directory into current tenant', async () => {
    const source = path.join(tmpDir, 'external-acme');
    writeFile(source, 'app.json', JSON.stringify({ name: 'external-acme' }));
    writeFile(source, 'employees/hr-onboarding.yaml', `
id: hr-onboarding
displayName: "HR 入职协调"
model: "glm-5-turbo"
role: "hr"
workspace: "agents/hr-onboarding"
systemPrompt: "负责入职协作"
tools: []
skills: []
allowedTargets: []
capabilities:
  - 入职
`);

    const res = await app.request('/api/employees/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: source }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { imported: string[]; count: number; skipped: string[] };
    expect(body).toMatchObject({ imported: ['hr-onboarding'], count: 1, skipped: [] });
    expect(fs.existsSync(path.join(tmpDir, 'target/employees/hr-onboarding.yaml'))).toBe(true);
    expect(manager.has('hr-onboarding')).toBe(true);
  });

  it('rejects paths that do not look like corp tenant directories', async () => {
    const source = path.join(tmpDir, 'random-folder');
    fs.mkdirSync(source, { recursive: true });

    const res = await app.request('/api/employees/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: source }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('corp tenant directory');
  });

  it('imports confirmed workdir skill drafts as employees', async () => {
    const source = path.join(tmpDir, 'source-workdir');
    writeFile(source, '.claude/skills/reporting/SKILL.md', `---
name: reporting
description: Generate reports
---

# Reporting
`);

    const res = await app.request('/api/employees/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: source,
        employeeDrafts: [{
          id: 'reporting-analyst',
          displayName: 'Reporting Analyst',
          role: 'reporting',
          description: 'Owns reporting workflows',
          skillNames: ['reporting'],
        }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { imported: string[]; count: number; skipped: string[] };
    expect(body).toMatchObject({ imported: ['reporting-analyst'], count: 1, skipped: [] });

    const yamlPath = path.join(tmpDir, 'target', 'employees', 'reporting-analyst.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    const yaml = fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toContain('displayName: Reporting Analyst');
    expect(yaml).toContain('- reporting');
    expect(manager.has('reporting-analyst')).toBe(true);
  });
});
