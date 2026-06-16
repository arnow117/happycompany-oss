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
