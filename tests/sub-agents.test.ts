import { describe, it, expect } from 'vitest';
import { PREDEFINED_AGENTS } from '../src/sub-agents.js';

const MUTATING_TOOLS = ['Write', 'Edit', 'Bash'];

describe('PREDEFINED_AGENTS', () => {
  it('has exactly 2 entries', () => {
    expect(Object.keys(PREDEFINED_AGENTS)).toEqual([
      'code-reviewer',
      'web-researcher',
    ]);
  });

  describe('code-reviewer', () => {
    const agent = PREDEFINED_AGENTS['code-reviewer'];

    it('has correct tools', () => {
      expect(agent.tools).toEqual(['Read', 'Glob', 'Grep']);
    });

    it('has maxTurns of 15', () => {
      expect(agent.maxTurns).toBe(15);
    });

    it('has non-empty description', () => {
      expect(agent.description.length).toBeGreaterThan(0);
    });

    it('has non-empty prompt', () => {
      expect(agent.prompt.length).toBeGreaterThan(0);
    });

    it('has only read-only tools', () => {
      for (const tool of agent.tools) {
        expect(MUTATING_TOOLS).not.toContain(tool);
      }
    });
  });

  describe('web-researcher', () => {
    const agent = PREDEFINED_AGENTS['web-researcher'];

    it('has correct tools', () => {
      expect(agent.tools).toEqual(['WebSearch', 'Read', 'Write']);
    });

    it('has maxTurns of 20', () => {
      expect(agent.maxTurns).toBe(20);
    });

    it('has non-empty description', () => {
      expect(agent.description.length).toBeGreaterThan(0);
    });

    it('has non-empty prompt', () => {
      expect(agent.prompt.length).toBeGreaterThan(0);
    });
  });
});
