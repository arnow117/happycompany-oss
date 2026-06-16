import type { KnowledgeTier } from './knowledge-resolver.js';
import { writeTierCard } from './knowledge-resolver.js';
import { resolveTierCards, readTierCard, type KnowledgeMergeResult } from './knowledge-resolver.js';
import { logger } from './logger.js';

export type KnowledgeChannel = 'vector' | 'markdown';

export interface RouteDecision {
  channel: KnowledgeChannel;
  reason: string;
}

const MARKDOWN_MAX_BYTES = 10 * 1024; // 10 KB

/**
 * Decide whether content should go to vector DB or markdown wiki.
 * Rules (channel agnostic to tier):
 * - Pure text under 10 KB → markdown
 * - Large text, binary files, or explicit vector flag → vector
 */
export function routeKnowledgeContent(
  content: string,
  opts?: { forceChannel?: KnowledgeChannel; hasAttachments?: boolean },
): RouteDecision {
  if (opts?.forceChannel) {
    return { channel: opts.forceChannel, reason: `forced to ${opts.forceChannel}` };
  }

  if (opts?.hasAttachments) {
    return { channel: 'vector', reason: 'has attachments — prefer vector' };
  }

  if (Buffer.byteLength(content, 'utf-8') > MARKDOWN_MAX_BYTES) {
    return { channel: 'vector', reason: `content > ${MARKDOWN_MAX_BYTES} bytes` };
  }

  return { channel: 'markdown', reason: 'short text → markdown wiki' };
}

/**
 * Ingest content at the appropriate tier.
 * Automatically routes through markdown channel.
 */
export function ingestKnowledgeCard(params: {
  tenantDir: string;
  tier: KnowledgeTier;
  tierId: string;
  name: string;
  content: string;
}): void {
  writeTierCard(params.tenantDir, params.tier, params.tierId, params.name, params.content);
}

/**
 * Search markdown knowledge across tiers.
 * Returns merged results with relevance scoring.
 */
export function searchMarkdownKnowledge(params: {
  tenantDir: string;
  employeeId?: string;
  groupId?: string;
  query: string;
}): Array<{ name: string; tier: KnowledgeTier; snippet: string; score: number }> {
  const result = resolveTierCards({
    tenantDir: params.tenantDir,
    employeeId: params.employeeId,
    groupId: params.groupId,
  });

  const queryTerms = params.query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const matched: Array<{ name: string; tier: KnowledgeTier; snippet: string; score: number }> = [];

  for (const card of result.cards) {
    const content = readTierCard(
      params.tenantDir,
      card.tier,
      card.tierId,
      card.name,
    );

    if (!content) continue;

    const text = content.content.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (text.includes(term)) score += 1;
      // Boost exact match in first 200 chars (title area)
      if (text.slice(0, 200).includes(term)) score += 0.5;
    }

    if (score > 0) {
      matched.push({
        name: card.name,
        tier: card.tier,
        snippet: content.content.slice(0, 300),
        score,
      });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched;
}
