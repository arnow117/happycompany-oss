import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type KnowledgeTier = 'company' | 'group' | 'employee';

export interface KnowledgeCard {
  name: string;
  tier: KnowledgeTier;
  tierId: string;
  size: number;
  updatedAt: string;
}

export interface KnowledgeMergeResult {
  cards: KnowledgeCard[];
  /** Which tiers contributed at least one card */
  tiers: KnowledgeTier[];
}

export interface KnowledgeResolveOptions {
  tenantDir: string;
  employeeId?: string;
  groupId?: string;
}

function tierDir(tenantDir: string, tier: KnowledgeTier, tierId?: string): string {
  switch (tier) {
    case 'company':
      return join(tenantDir, 'knowledge', 'company');
    case 'group':
      return join(tenantDir, 'knowledge', 'groups', tierId ?? 'default');
    case 'employee':
      return join(tenantDir, 'knowledge', 'employees', tierId ?? 'anonymous');
  }
}

function scanTierCards(dir: string, tier: KnowledgeTier, tierId: string): KnowledgeCard[] {
  if (!existsSync(dir)) return [];
  const cards: KnowledgeCard[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const st = statSync(join(dir, entry.name));
      cards.push({
        name: entry.name.replace(/\.md$/, ''),
        tier,
        tierId,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    }
  } catch { /* unreadable */ }
  return cards;
}

/**
 * Resolve knowledge cards across three tiers.
 * Scan order: employee → group → company.
 * Merge: card names seen in a higher-priority tier overwrite lower-priority ones.
 */
export function resolveTierCards(opts: KnowledgeResolveOptions): KnowledgeMergeResult {
  const tiers: KnowledgeTier[] = [];
  const seen = new Map<string, KnowledgeCard>();

  // Priority: employee (highest) → group → company (lowest)
  const scans: Array<{ tier: KnowledgeTier; tierId: string }> = [
    { tier: 'employee', tierId: opts.employeeId ?? 'anonymous' },
    { tier: 'group', tierId: opts.groupId ?? 'default' },
    { tier: 'company', tierId: 'default' },
  ];

  for (const { tier, tierId } of scans) {
    const dir = tierDir(opts.tenantDir, tier, tierId);
    const cards = scanTierCards(dir, tier, tierId);
    if (cards.length > 0) tiers.push(tier);
    for (const card of cards) {
      if (!seen.has(card.name)) {
        seen.set(card.name, card);
      }
      // De-duplicate: higher priority tier (scanned first) wins
    }
  }

  const cards = Array.from(seen.values());
  return { cards, tiers };
}

/**
 * Create or overwrite a knowledge card at a specific tier.
 */
export function writeTierCard(
  tenantDir: string,
  tier: KnowledgeTier,
  tierId: string,
  name: string,
  content: string,
): void {
  const dir = tierDir(tenantDir, tier, tierId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content, 'utf-8');
}

/**
 * Delete a knowledge card from a specific tier.
 */
export function deleteTierCard(
  tenantDir: string,
  tier: KnowledgeTier,
  tierId: string,
  name: string,
): boolean {
  const filePath = join(tierDir(tenantDir, tier, tierId), `${name}.md`);
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  return true;
}

/**
 * Read a single knowledge card's content from a specific tier.
 */
export function readTierCard(
  tenantDir: string,
  tier: KnowledgeTier,
  tierId: string,
  name: string,
): { content: string; updatedAt: string } | null {
  const filePath = join(tierDir(tenantDir, tier, tierId), `${name}.md`);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  const updatedAt = statSync(filePath).mtime.toISOString();
  return { content, updatedAt };
}

/**
 * List all index.md-style entries across resolved tiers.
 * Returns merged card list suitable for displaying in a knowledge browser.
 */
export function listResolvedCards(opts: KnowledgeResolveOptions): KnowledgeMergeResult {
  return resolveTierCards(opts);
}
