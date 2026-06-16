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

  function writeToolsJson(tenant: string, skill: string, content: object): string {
    const dir = path.join(tmpDir, tenant, '.claude', 'skills', skill);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${skill}\n`, 'utf-8');
    const filePath = path.join(dir, 'tools.json');
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  it('discovers and registers tools from corp/*/.claude/skills/*/tools.json', () => {
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
    expect(registry.lookup('acme', 'med_crm:search_hospitals')).toBeDefined();
    expect(registry.lookup('acme', 'med_crm:search_hospitals')!.tenantName).toBe('acme');
    expect(registry.lookup('acme', 'med_crm:search_hospitals')!.skillDir).toBe(
      fs.realpathSync(path.join(tmpDir, 'acme', '.claude', 'skills', 'med_crm')),
    );
  });

  it('namespaces tools with skill:tool_name prefix', () => {
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

    expect(registry.lookup('acme', 'med_crm:search_hospitals')).toBeDefined();
    expect(registry.lookup('acme', 'device_kb:search')).toBeDefined();
    expect(registry.lookup('acme', 'search_hospitals')).toBeUndefined();
  });

  it('returns empty array for unknown tenant', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.scan();
    expect(registry.getToolsForTenant('nonexistent')).toHaveLength(0);
  });

  it('returns skill summaries for progressive disclosure', () => {
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

    const summaries = registry.getSkillSummaries('acme');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].name).toBe('med_crm');
    expect(summaries[0].displayName).toBe('医院CRM');
    expect(summaries[0].toolCount).toBe(2);
  });

  it('returns full tool list for a specific skill', () => {
    writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: { keyword: { type: 'string' } } } },
        { name: 'add_contact', description: '添加联系人', riskLevel: 'internal_write', parameters: { type: 'object', properties: {} } },
      ],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    const tools = registry.getSkillTools('acme', 'med_crm');
    expect(tools).toHaveLength(2);
    expect(tools[0].namespacedName).toBe('med_crm:search_hospitals');
  });

  it('returns server configs for skills with a JSON-RPC server', () => {
    const toolsPath = writeToolsJson('acme', 'med_crm', {
      name: 'med_crm',
      tools: [
        { name: 'search_hospitals', description: '搜索医院', riskLevel: 'read', parameters: { type: 'object', properties: {} } },
      ],
      server: { entry: 'med_crm/server.py', python: 'python3' },
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.getSkillServers()).toEqual([
      {
        tenantName: 'acme',
        skillName: 'med_crm',
        appName: 'med_crm',
        cwd: fs.realpathSync(path.dirname(toolsPath)),
        entry: 'med_crm/server.py',
        python: 'python3',
      },
    ]);
  });

  it('validates tools.json with Zod and skips invalid files', () => {
    const dir = path.join(tmpDir, 'acme', '.claude', 'skills', 'bad_app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# bad_app\n');
    fs.writeFileSync(path.join(dir, 'tools.json'), 'not json at all');

    writeToolsJson('acme', 'good_app', {
      name: 'good_app',
      tools: [{ name: 'do_stuff', description: '做事情', riskLevel: 'read', parameters: { type: 'object', properties: {} } }],
    });

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.getToolsForTenant('acme')).toHaveLength(1);
    expect(registry.lookup('acme', 'good_app:do_stuff')).toBeDefined();
  });

  it('does not discover legacy corp/*/apps/*/tools.json manifests', () => {
    const dir = path.join(tmpDir, 'acme', 'apps', 'legacy_app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify({
      name: 'legacy_app',
      tools: [{ name: 'do_stuff', description: '旧工具', riskLevel: 'read', parameters: { type: 'object', properties: {} } }],
    }));

    const registry = new ToolRegistry(tmpDir);
    registry.scan();

    expect(registry.getToolsForTenant('acme')).toHaveLength(0);
    expect(registry.lookup('acme', 'legacy_app:do_stuff')).toBeUndefined();
  });

  it('handles missing corp directory gracefully', () => {
    const registry = new ToolRegistry('/nonexistent/path');
    registry.scan();
    expect(registry.getToolsForTenant('any')).toHaveLength(0);
  });
});
