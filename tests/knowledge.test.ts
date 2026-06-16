import { describe, it, expect } from 'vitest';

// We can't test actual OpenViking without the server running,
// so we test the MCP server construction and tool schema.

describe('Knowledge Engine', () => {
  it('buildKnowledgeMcpServer creates an MCP server with correct name', async () => {
    // Dynamic import to avoid issues if openviking is not available
    const { buildKnowledgeMcpServer } = await import('../src/knowledge.js');
    const server = buildKnowledgeMcpServer({});
    expect(server).toBeDefined();
    expect(server.name).toBe('knowledge');
  });

  it('searchOpenViking returns empty results when server is unreachable', async () => {
    const { searchOpenViking } = await import('../src/knowledge.js');
    const results = await searchOpenViking('test query', { baseUrl: 'http://127.0.0.1:19999' });
    expect(results).toEqual([]);
  });
});
