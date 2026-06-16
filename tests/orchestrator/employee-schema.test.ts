import { describe, it, expect } from 'vitest';
import { employeeDefinitionSchema } from '../../src/orchestrator/employee-schema.js';

describe('employeeDefinitionSchema', () => {
  it('accepts valid minimal config with only required fields', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'test-app',
      displayName: 'Test App',
    });
    expect(result.id).toBe('test-app');
    expect(result.displayName).toBe('Test App');
    expect(result.description).toBe('');
    expect(result.model).toBe('');
    expect(result.systemPrompt).toBe('');
    expect(result.maxTurns).toBe(50);
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.workspace).toBe('');
    expect(result.role).toBe('');
    expect(result.allowedTargets).toEqual([]);
  });

  it('accepts full config with all fields', () => {
    const input = {
      id: 'sales-assistant',
      displayName: 'Sales Assistant',
      description: 'A sales assistant',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a sales assistant',
      maxTurns: 100,
      tools: ['med_crm:search_hospitals', 'med_crm:*'],
      skills: ['med_crm'],
      workspace: './workdir',
      role: 'sales',
      schedule: {
        triggers: [
          { type: 'cron', value: '0 9 * * 1-5', prompt: 'Check tasks', enabled: true },
          { type: 'interval', value: 'PT1H', prompt: 'Check messages', enabled: false },
          { type: 'once', value: '2026-05-10T09:00:00+08:00', prompt: 'Follow up', enabled: true },
        ],
      },
      allowedTargets: ['sales-mgr', 'finance'],
      retry: { maxRetries: 5, maxModelRetries: 10 },
      channel: 'dingtalk' as const,
      channelConfig: { webhook: 'https://example.com' },
    };
    const result = employeeDefinitionSchema.parse(input);
    expect(result.id).toBe('sales-assistant');
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.tools).toHaveLength(2);
    expect(result.skills).toEqual(['med_crm']);
    expect(result.schedule?.triggers).toHaveLength(3);
    expect(result.retry?.maxRetries).toBe(5);
    expect(result.channel).toBe('dingtalk');
    expect(result.channelConfig).toEqual({ webhook: 'https://example.com' });
  });

  it('rejects missing id', () => {
    const result = employeeDefinitionSchema.safeParse({
      displayName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing displayName', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: '',
      displayName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty displayName', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'test',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'defaults-test',
      displayName: 'Defaults Test',
    });
    expect(result.maxTurns).toBe(50);
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.allowedTargets).toEqual([]);
    expect(result.description).toBe('');
    expect(result.model).toBe('');
    expect(result.systemPrompt).toBe('');
    expect(result.workspace).toBe('');
    expect(result.role).toBe('');
    expect(result.schedule).toBeUndefined();
    expect(result.retry).toBeUndefined();
    expect(result.channel).toBeUndefined();
    expect(result.channelConfig).toBeUndefined();
  });

  it('validates schedule triggers', () => {
    const valid = employeeDefinitionSchema.safeParse({
      id: 'sched-test',
      displayName: 'Schedule Test',
      schedule: {
        triggers: [
          { type: 'cron', value: '*/5 * * * *', prompt: 'Poll', enabled: true },
        ],
      },
    });
    expect(valid.success).toBe(true);
  });

  it('rejects invalid schedule type', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'bad-sched',
      displayName: 'Bad Schedule',
      schedule: {
        triggers: [
          { type: 'invalid_type' as any, value: 'contract.signed', prompt: 'Handle', enabled: true },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel value', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'bad-channel',
      displayName: 'Bad Channel',
      channel: 'slack',
    });
    expect(result.success).toBe(false);
  });

  it('accepts tools with wildcard patterns', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'wildcard-test',
      displayName: 'Wildcard',
      tools: ['med_crm:search_hospitals', 'med_crm:search_*', 'med_crm:*', 'stats:*'],
    });
    expect(result.tools).toHaveLength(4);
  });

  it('accepts empty tools and skills arrays', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'empty-test',
      displayName: 'Empty',
      tools: [],
      skills: [],
    });
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it('accepts schedule trigger with default enabled', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'default-enabled',
      displayName: 'Default Enabled',
      schedule: {
        triggers: [
          { type: 'cron', value: '0 9 * * *', prompt: 'Morning check' },
        ],
      },
    });
    expect(result.schedule?.triggers[0]?.enabled).toBe(true);
  });

  it('accepts retry config with defaults', () => {
    const result = employeeDefinitionSchema.parse({
      id: 'retry-test',
      displayName: 'Retry',
      retry: {},
    });
    expect(result.retry?.maxRetries).toBe(3);
    expect(result.retry?.maxModelRetries).toBe(5);
  });

  it('rejects negative maxTurns', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'neg-turns',
      displayName: 'Negative',
      maxTurns: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxTurns', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'float-turns',
      displayName: 'Float',
      maxTurns: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
