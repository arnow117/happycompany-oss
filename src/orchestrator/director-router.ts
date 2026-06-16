import { buildPrompt, PROMPT_IDS } from '../prompts/index.js';

// ── Types ──────────────────────────────────────────────────

export interface AgentMeta {
  id: string;
  capabilities: string[];
  role: string;
  description: string;
}

export interface RouteResult {
  agentId: string | null;
  reason: string;
  method: 'keyword' | 'llm' | 'direct';
  keywordScore?: number;
  candidates?: Array<{ agentId: string; score: number }>;
}

interface DirectorConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
}

// ── Helpers ────────────────────────────────────────────────

/** Split text into tokens: individual CJK chars + alphabetic words. */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  // Extract CJK bigrams so broad single characters do not dominate routing.
  const cjkRuns = text.match(/[一-鿿㐀-䶿]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      if (run.length === 1) tokens.add(run);
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  // Extract alphabetic/numeral words
  const words = text.toLowerCase().match(/[a-z0-9]+/g);
  if (words) words.forEach((w) => tokens.add(w));
  return tokens;
}

const GENERIC_CJK_TERMS = new Set([
  '员工',
  '企业',
  '流程',
  '工作',
  '编排',
  '处理',
  '问题',
  '请求',
]);

const DOMAIN_PRIORITY_TERMS = new Set([
  '维修',
  '工单',
  '故障',
  '回执',
  '销售',
  '合同',
  '客户',
  '财务',
  '发票',
  '结算',
  '税务',
  '入职',
  '账号',
  '权限',
  '门禁',
]);

/**
 * Compute keyword overlap scores for all agents against the task.
 * Score is matches / total_agent_keywords, capped at 1.0.
 */
function computeKeywordScores(
  task: string,
  agents: AgentMeta[],
): Array<{ agentId: string; score: number }> {
  const taskTokens = tokenize(task);
  const normalizedTask = task.toLowerCase();

  return agents.map((agent) => {
    // Score each capability/field independently, take the best overlap
    const fields = [...agent.capabilities, agent.role, agent.description];
    let bestScore = 0;

    for (const rawField of fields) {
      const field = rawField.trim();
      if (!field) continue;
      const isGeneric = GENERIC_CJK_TERMS.has(field);
      const isPriority = DOMAIN_PRIORITY_TERMS.has(field);
      if (normalizedTask.includes(field.toLowerCase())) {
        bestScore = Math.max(bestScore, isGeneric ? 0.35 : (isPriority ? 2 : 1.2));
        continue;
      }

      const fieldTokens = tokenize(field);
      if (fieldTokens.size === 0) continue;

      let matches = 0;
      for (const token of taskTokens) {
        if (fieldTokens.has(token)) matches++;
      }

      // Prefer concrete responsibility overlap. The old ratio favored broad
      // generic fields like "员工" over a specific hit like "维修".
      const score = matches / Math.sqrt(fieldTokens.size);
      if (score > bestScore) bestScore = score;
    }

    return { agentId: agent.id, score: bestScore };
  });
}

// ── Public API ─────────────────────────────────────────────

/**
 * Match a task to an agent by keyword overlap.
 * Returns the best-matching agent if its score meets the threshold.
 */
export function keywordMatch(
  task: string,
  agents: AgentMeta[],
  threshold: number = 0.5,
): { agentId: string; score: number } | null {
  const scores = computeKeywordScores(task, agents);
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (best && best.score >= threshold) {
    return best;
  }
  return null;
}

/** Try to extract a JSON object from a text response. */
function extractJson(text: string): Record<string, unknown> | null {
  const braceMatch = text.match(/\{(?:[^{}]|"(?:[^"\\]|\\.)*")*\}/);
  if (!braceMatch) return null;
  try {
    const parsed = JSON.parse(braceMatch[0]);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not valid JSON
  }
  return null;
}

/** Parse the Anthropic response text into agent ID + reason. */
function parseLLMResponse(text: string): { agentId: string | null; reason: string } {
  const json = extractJson(text);
  if (!json) {
    return { agentId: null, reason: 'Could not parse LLM response as JSON' };
  }

  const nextAgent = json.next_agent;
  const reason = typeof json.reason === 'string' ? json.reason : '';

  if (nextAgent === 'NONE' || !nextAgent || typeof nextAgent !== 'string') {
    return { agentId: null, reason: reason || 'No agent matched by LLM' };
  }

  return { agentId: nextAgent, reason: reason || 'Matched by LLM' };
}

/**
 * Use the LLM to find the best agent for a task by calling the
 * Anthropic Messages API with the director prompt template.
 * On any API error, returns a graceful fallback.
 */
export async function llmMatch(
  task: string,
  agents: AgentMeta[],
  config: DirectorConfig,
): Promise<{ agentId: string | null; reason: string }> {
  const agentList = agents
    .map(
      (a) =>
        `- ${a.id} (${a.role}): ${a.capabilities.join(', ')} — ${a.description}`,
    )
    .join('\n');

  const prompt = buildPrompt(PROMPT_IDS.DIRECTOR, { task, agentList });
  const baseUrl = config.baseUrl || 'https://api.anthropic.com';
  const model = config.model || 'claude-haiku-4-5';

  const messages = [{ role: 'user' as const, content: prompt.user || task }];

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        temperature: 0,
        system: prompt.system,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        agentId: null,
        reason: `LLM routing failed: HTTP ${response.status} - ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const textContent =
      data.content?.find((c) => c.type === 'text')?.text || '';

    return parseLLMResponse(textContent);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { agentId: null, reason: `LLM routing failed: ${msg}` };
  }
}

// ── Orchestrator ───────────────────────────────────────────

/**
 * Two-tier routing: direct → keyword → LLM.
 *
 * - 1 agent  → direct match
 * - keyword hit → return immediately with scores
 * - keyword miss + director enabled → try LLM
 * - keyword miss + director disabled  → return NONE
 *
 * Never throws — always returns a RouteResult.
 */
export async function routeHandoff(
  task: string,
  agents: AgentMeta[],
  directorConfig: DirectorConfig,
): Promise<RouteResult> {
  // Tier 0: only one agent available
  if (agents.length === 1) {
    return {
      agentId: agents[0].id,
      reason: `Single agent: ${agents[0].id}`,
      method: 'direct',
    };
  }

  // Tier 1: keyword matching
  const scores = computeKeywordScores(task, agents);
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const best = sorted[0];

  if (best && best.score >= 0.5) {
    return {
      agentId: best.agentId,
      reason: `Keyword match score ${best.score.toFixed(2)}`,
      method: 'keyword',
      keywordScore: best.score,
      candidates: sorted,
    };
  }

  // Tier 2: LLM (only if enabled)
  if (!directorConfig.enabled) {
    return {
      agentId: null,
      reason: 'No keyword match and LLM routing is disabled',
      method: 'keyword',
      candidates: sorted,
    };
  }

  const llmResult = await llmMatch(task, agents, directorConfig);

  if (llmResult.agentId) {
    return {
      agentId: llmResult.agentId,
      reason: llmResult.reason,
      method: 'llm',
      candidates: sorted,
    };
  }

  return {
    agentId: null,
    reason: llmResult.reason,
    method: 'llm',
    candidates: sorted,
  };
}
