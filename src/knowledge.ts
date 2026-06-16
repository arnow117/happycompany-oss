import { tool, createSdkMcpServer, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from './logger.js';
import { searchMarkdownKnowledge } from './knowledge-router.js';

export interface KnowledgeConfig {
  baseUrl?: string;
  collectionName?: string;
  topK?: number;
  corpDir?: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:1933';
const DEFAULT_COLLECTION = 'default';
const DEFAULT_TOP_K = 5;

export async function searchOpenViking(
  query: string,
  config: KnowledgeConfig,
): Promise<Array<{ source: string; score: number; snippet: string }>> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const topK = config.topK ?? DEFAULT_TOP_K;

  const url = `${baseUrl}/api/collections/${DEFAULT_COLLECTION}/search`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        top_k: topK,
        mode: 'hybrid',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: text.slice(0, 200) }, 'OpenViking search failed');
      return [];
    }

    const data = (await res.json()) as {
      results?: Array<{
        document?: { content?: string; metadata?: Record<string, unknown> };
        score?: number;
      }>;
    };

    return (data.results ?? []).map((r) => ({
      source: String(r.document?.metadata?.source ?? 'unknown'),
      score: r.score ?? 0,
      snippet: r.document?.content?.slice(0, 500) ?? '',
    }));
  } catch (err) {
    logger.warn({ err, baseUrl }, 'OpenViking connection failed');
    return [];
  }
}

export function buildKnowledgeMcpServer(config: KnowledgeConfig): McpSdkServerConfigWithInstance {
  const baseTools = [
    tool(
      'knowledge_search',
      'Search the knowledge base using semantic (vector) search. Returns relevant document snippets.',
      {
        query: z.string().describe('Search query (natural language)'),
        top_k: z.number().max(20).optional().describe('Max results (default: 5)'),
      },
      async ({ query, top_k }) => {
        const results = await searchOpenViking(query, { ...config, topK: top_k });
        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No vector results found.' }],
          };
        }
        const lines = results.map(
          (r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)}, source: ${r.source})\n${r.snippet}`,
        );
        return {
          content: [{ type: 'text' as const, text: lines.join('\n\n') }],
        };
      },
    ),
  ];

  if (config.corpDir) {
    return createSdkMcpServer({
      name: 'knowledge',
      version: '1.1.0',
      tools: [
        ...baseTools,
        tool(
          'knowledge_md_search',
          'Search the markdown knowledge wiki (company/group/employee tiers). Use for structured knowledge cards.',
          {
            query: z.string().describe('Search query'),
            tenant: z.string().describe('Tenant name (e.g., acme)'),
            employee_id: z.string().optional().describe('Employee userId for personal tier'),
            group_id: z.string().optional().describe('Group id (e.g., role name)'),
          },
          async ({ query, tenant, employee_id, group_id }) => {
            const tenantDir = `${config.corpDir}/${tenant}`;
            const results = searchMarkdownKnowledge({
              tenantDir,
              employeeId: employee_id,
              groupId: group_id,
              query,
            });
            if (results.length === 0) {
              return {
                content: [{ type: 'text' as const, text: 'No markdown knowledge cards found.' }],
              };
            }
            const lines = results.map(
              (r, i) =>
                `[${i + 1}] [${r.tier}] ${r.name} (score: ${r.score})\n${r.snippet.slice(0, 200)}`,
            );
            return {
              content: [{ type: 'text' as const, text: lines.join('\n\n') }],
            };
          },
        ),
      ],
      alwaysLoad: true,
    });
  }

  return createSdkMcpServer({
    name: 'knowledge',
    version: '1.0.0',
    tools: baseTools,
    alwaysLoad: true,
  });
}
