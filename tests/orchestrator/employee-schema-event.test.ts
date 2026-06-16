import { describe, it, expect } from 'vitest';
import { employeeDefinitionSchema } from '../../src/orchestrator/employee-schema.js';

describe('EmployeeDefinition event trigger schema', () => {
  it('accepts event trigger in schedule', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'test-agent',
      displayName: 'Test',
      schedule: {
        triggers: [
          { type: 'event', value: 'contract.signed', prompt: 'Handle new contract', enabled: true },
        ],
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.schedule?.triggers?.[0]?.type).toBe('event');
  });

  it('rejects event trigger without value', () => {
    const result = employeeDefinitionSchema.safeParse({
      id: 'test-agent',
      displayName: 'Test',
      schedule: {
        triggers: [
          { type: 'event', value: '', prompt: 'test', enabled: true },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});
