export { buildPrompt } from './loader.js';

/** Well-known prompt IDs. Add new entries as templates are created. */
export const PROMPT_IDS = {
  AGENT_GENERATION: 'agent-generation',
  AGENT_OPTIMIZE: 'agent-optimize',
  DIRECTOR: 'director',
} as const;

export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];
