import { describe, it, expect } from 'vitest';
import { toolManifestSchema, appJsonSchema, riskLevelSchema, skillToolSchema, skillToolManifestSchema } from '../src/tool-schemas.js';

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
