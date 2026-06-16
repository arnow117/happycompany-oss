export interface AgentDefinition {
  description: string;
  prompt: string;
  tools: string[];
  maxTurns: number;
}

export const PREDEFINED_AGENTS: Record<string, AgentDefinition> = {
  'code-reviewer': {
    description:
      'Code review agent that analyzes code quality, best practices, and potential issues',
    prompt: `You are a strict code reviewer. Analyze code for:
- Correctness: bugs, logic errors, edge cases
- Security: vulnerabilities, injection risks, credential leaks
- Performance: unnecessary allocations, N+1 queries, missing caching
- Maintainability: naming, structure, complexity
Reference specific locations with file:line format. Be concise and actionable. Focus on real issues, not style nitpicks.`,
    tools: ['Read', 'Glob', 'Grep'],
    maxTurns: 15,
  },
  'web-researcher': {
    description:
      'Web research agent that searches and extracts information from web pages',
    prompt: `You are an efficient web researcher. Your workflow:
1. Search for the most relevant and authoritative sources
2. Extract key facts, data points, and quotes
3. Synthesize findings into a clear summary
4. Cite all sources with URLs
Prefer primary sources and official documentation. Verify claims across multiple sources when possible.`,
    tools: ['WebSearch', 'Read', 'Write'],
    maxTurns: 20,
  },
};
