export interface HandoffPayload {
  event: string;
  contractId?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

interface HandoffJson {
  type: string;
  target_agent: string;
  payload: HandoffPayload;
}


export class HandoffRequest {
  readonly type = 'handoff_request' as const;
  readonly targetAgent: string;
  readonly payload: HandoffPayload;

  constructor(targetAgent: string, payload: HandoffPayload) {
    this.targetAgent = targetAgent;
    this.payload = payload;
  }

  toJson(): HandoffJson {
    return {
      type: this.type,
      target_agent: this.targetAgent,
      payload: this.payload,
    };
  }

  static fromJson(json: HandoffJson): HandoffRequest {
    return new HandoffRequest(json.target_agent, json.payload);
  }
}

export function extractHandoffRequest(text: string): HandoffRequest | null {
  // Strip markdown code fences before searching
  const stripped = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');

  // Use bracket counting to extract JSON objects containing "handoff_request".
  // Intentionally lenient about field names: models may use target/to instead of
  // target_agent, or details instead of payload.context — fall back to director
  // routing when target is absent.
  const marker = '"handoff_request"';
  let searchFrom = 0;
  while (true) {
    const markerIdx = stripped.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;

    // Walk left to find the opening brace of the enclosing object
    let openBrace = markerIdx - 1;
    while (openBrace >= 0 && stripped[openBrace] !== '{') openBrace--;
    if (openBrace < 0) { searchFrom = markerIdx + 1; continue; }

    // Walk right counting braces to find the matching closing brace
    let depth = 0;
    let closeBrace = -1;
    for (let i = openBrace; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') {
        depth--;
        if (depth === 0) { closeBrace = i; break; }
      }
    }
    if (closeBrace === -1) { searchFrom = markerIdx + 1; continue; }

    try {
      const raw = JSON.parse(stripped.slice(openBrace, closeBrace + 1)) as Record<string, unknown>;
      if (raw['type'] !== 'handoff_request') { searchFrom = markerIdx + 1; continue; }

      // Accept target from several common field names; empty → director routing
      const targetAgent = String(raw['target_agent'] ?? raw['target'] ?? raw['to'] ?? '');

      // Accept payload from structured payload or flat fields, preserving
      // contract/receipt IDs for trace visualization.
      const rawPayload = isRecord(raw['payload']) ? raw['payload'] : {};
      const event = String(
        rawPayload['event'] ?? raw['task'] ?? raw['message'] ?? raw['request_id'] ?? '',
      );
      const context = isRecord(rawPayload['context'])
        ? rawPayload['context']
        : isRecord(raw['details'])
          ? raw['details']
          : isRecord(raw['context'])
            ? raw['context']
            : {};

      return new HandoffRequest(targetAgent, { ...rawPayload, event, context });
    } catch { /* not valid JSON, keep searching */ }
    searchFrom = markerIdx + 1;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

interface ToolUseMessage {
  type?: string;
  tool_use?: {
    name?: string;
    input?: {
      target?: string;
      task?: string;
      context?: Record<string, unknown>;
    };
  };
}

export function extractHandoffFromToolUse(msg: unknown): HandoffRequest | null {
  if (!msg || typeof msg !== 'object') return null;

  const typed = msg as ToolUseMessage;
  if (typed.type !== 'tool_use') return null;
  if (typed.tool_use?.name !== 'handoff') return null;

  const input = typed.tool_use?.input;
  if (!input?.task) return null;

  const payload: HandoffPayload = {
    event: input.task,
    context: input.context ?? {},
  };

  return new HandoffRequest(input.target ?? '', payload);
}

export function claimsCompletedHandoff(text: string): boolean {
  const normalized = text.toLowerCase();
  const completedHandoffPatterns = [
    /(?:已|已经|成功|完成).{0,16}(?:handoff|转交|移交|交接|转派|发出)/i,
    /(?:handoff|转交|移交|交接|转派).{0,16}(?:已|已经|成功|完成|发出|到达)/i,
    /handoff.{0,24}(?:completed|sent|transferred|delivered|acknowledged)/i,
  ];

  return completedHandoffPatterns.some((pattern) => pattern.test(normalized));
}

export function buildHandoffToolSpec(): object {
  return {
    name: 'handoff',
    description:
      'Transfer your current task to another digital employee. Call this when you have completed your work and someone else needs to take over, or when you encounter a problem outside your capabilities. If you know which colleague should handle this, fill in target. Otherwise leave target empty and the dispatcher will find the right person.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Optional. The agent ID to handoff to (e.g. \'sales-zhangsan\'). Leave empty for automatic routing.',
        },
        task: {
          type: 'string',
          description:
            'Description of what needs to be done next. Be specific — include relevant IDs, context, and the desired outcome.',
        },
        context: {
          type: 'object',
          description:
            'Optional. Additional structured context like {contractId: \'...\', priority: \'high\'}.',
        },
      },
      required: ['task'],
    },
  };
}
