import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmployeeLoader, type LoadedEmployee } from '../src/orchestrator/employee-loader.js';
import type { ClaudeAgent } from '../src/agent.js';
import type { ToolRegistry } from '../src/tool-registry.js';
import type { AppServerMgr } from '../src/app-server.js';
import { SkillBridge } from '../src/orchestrator/skill-bridge.js';
import { EmployeeManager, type EmployeeManagerDeps } from '../src/orchestrator/employee-colony.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'colony-reload-test-'));
}

function writeYaml(dir: string, relativePath: string, content: string): string {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('Colony hot reload integration', () => {
  let tmpDir: string;
  let loader: EmployeeLoader;
  let colony: EmployeeManager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    loader = new EmployeeLoader({ corpDir: tmpDir });
    const skillBridge = new SkillBridge({
      toolRegistry: {
        getToolsForTenant: () => [],
      } as unknown as ToolRegistry,
      appServerMgr: {
        call: async () => ({}),
        callCli: async () => ({}),
        getServerStatus: () => ({ running: false }),
      } as unknown as AppServerMgr,
      corpDir: tmpDir,
    });
    colony = new EmployeeManager({
      globalModel: 'claude-sonnet-4-6',
      createAgent: (opts) => ({
        respond: async () => 'ok',
        ...opts,
      }) as unknown as ClaudeAgent,
      skillBridge,
      corpDir: tmpDir,
      dataDir: '/data',
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects new YAML file and registers it in colony', () => {
    const apps = loader.load();
    colony.registerAll(apps);
    expect(colony.getAppIds()).toEqual([]);

    // Add a new YAML file
    writeYaml(tmpDir, 'tenant1/employees/new-agent.yaml', `
id: new-agent
displayName: "New Agent"
`);
    const { added } = loader.reload(apps);
    expect(added).toHaveLength(1);

    // Simulate hot reload: register added, skip removed/changed
    for (const app of added) {
      colony.register(app);
    }
    expect(colony.getAppIds()).toEqual(['new-agent']);
  });

  it('detects removed YAML file and removes from colony', () => {
    const filePath = writeYaml(tmpDir, 'tenant1/employees/to-remove.yaml', `
id: to-remove
displayName: "To Remove"
`);
    const apps = loader.load();
    colony.registerAll(apps);
    expect(colony.getAppIds()).toEqual(['to-remove']);

    // Remove the file
    fs.unlinkSync(filePath);
    const { removed } = loader.reload(apps);
    expect(removed).toHaveLength(1);

    // Simulate hot reload: remove from colony
    for (const app of removed) {
      colony.remove(app.id);
    }
    expect(colony.getAppIds()).toEqual([]);
  });

  it('detects changed YAML file and re-registers in colony', () => {
    const filePath = writeYaml(tmpDir, 'tenant1/employees/to-change.yaml', `
id: to-change
displayName: "Original"
`);
    const apps = loader.load();
    colony.registerAll(apps);
    expect(colony.has('to-change')).toBe(true);

    // Modify the file (touch to change mtime)
    const { utimesSync } = fs;
    fs.writeFileSync(filePath, `
id: to-change
displayName: "Updated"
`);
    const { changed } = loader.reload(apps);
    expect(changed).toHaveLength(1);
    expect(changed[0].displayName).toBe('Updated');

    // Simulate hot reload: remove and re-register
    for (const app of changed) {
      colony.remove(app.id);
      colony.register(app);
    }
    expect(colony.has('to-change')).toBe(true);
    const reloadedApp = colony.get('to-change')!.app;
    expect(reloadedApp.displayName).toBe('Updated');
  });

  it('handles mixed add/remove/change in one reload', () => {
    const f1 = writeYaml(tmpDir, 'tenant1/employees/keep.yaml', `
id: keep
displayName: "Keep Me"
`);
    writeYaml(tmpDir, 'tenant1/employees/remove.yaml', `
id: remove
displayName: "Remove Me"
`);

    const apps = loader.load();
    colony.registerAll(apps);
    expect(colony.getAppIds().sort()).toEqual(['keep', 'remove']);

    // Remove one, add one, change one
    fs.unlinkSync(path.join(tmpDir, 'tenant1/employees/remove.yaml'));
    writeYaml(tmpDir, 'tenant1/employees/add.yaml', `
id: add
displayName: "Add Me"
`);
    const { utimesSync } = fs;
    utimesSync(f1, new Date(), new Date(Date.now() + 5000));

    const delta = loader.reload(apps);
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0].id).toBe('add');
    expect(delta.removed).toHaveLength(1);
    expect(delta.removed[0].id).toBe('remove');
    expect(delta.changed).toHaveLength(1);
    expect(delta.changed[0].id).toBe('keep');
    expect(delta.unchanged).toHaveLength(0);
  });

  it('config.json reload does not affect colony agents', () => {
    writeYaml(tmpDir, 'tenant1/employees/colony-agent.yaml', `
id: colony-agent
displayName: "Colony Agent"
`);
    const apps = loader.load();
    colony.registerAll(apps);
    expect(colony.getAppIds()).toEqual(['colony-agent']);

    // Reload without changes
    const delta = loader.reload(apps);
    expect(delta.added).toHaveLength(0);
    expect(delta.removed).toHaveLength(0);
    expect(delta.changed).toHaveLength(0);
    expect(colony.getAppIds()).toEqual(['colony-agent']);
  });
});
