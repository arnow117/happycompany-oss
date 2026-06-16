import { z } from 'zod';
import { employeeDefinitionSchema } from '../orchestrator/employee-schema.js';

export const agentDraftSourceSchema = z.enum(['natural_language', 'template', 'fork', 'manual']);
export type AgentDraftSource = z.infer<typeof agentDraftSourceSchema>;

export const agentDraftStatusSchema = z.enum(['draft', 'validated', 'tested', 'published']);
export type AgentDraftStatus = z.infer<typeof agentDraftStatusSchema>;

export const agentBuilderIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  field: z.string(),
  message: z.string(),
});
export type AgentBuilderIssue = z.infer<typeof agentBuilderIssueSchema>;

export const agentDraftSchema = z.object({
  id: z.string().min(1),
  tenant: z.string().min(1),
  source: agentDraftSourceSchema,
  status: agentDraftStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  input: z
    .object({
      naturalLanguage: z.string().optional(),
      templateId: z.string().optional(),
      sourceEmployeeId: z.string().optional(),
    })
    .optional(),
  employee: employeeDefinitionSchema,
  validation: z.object({
    ok: z.boolean(),
    issues: z.array(agentBuilderIssueSchema),
  }),
  harness: z
    .object({
      yaml: z.string(),
      lastResult: z.enum(['passed', 'failed', 'error']).optional(),
      failures: z.array(z.string()).optional(),
    })
    .optional(),
  sandbox: z
    .object({
      lastSessionId: z.string(),
      lastResult: z.enum(['passed', 'failed', 'error']),
      reply: z.string().optional(),
      testedAt: z.number(),
      fingerprint: z.string(),
    })
    .optional(),
});
export type AgentDraft = z.infer<typeof agentDraftSchema>;

export const createAgentDraftBodySchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('natural_language'),
    tenant: z.string().min(1),
    prompt: z.string().min(1),
  }),
  z.object({
    source: z.literal('template'),
    tenant: z.string().min(1),
    templateId: z.string().min(1),
    role: z.string().min(1),
  }),
  z.object({
    source: z.literal('fork'),
    tenant: z.string().min(1),
    sourceEmployeeId: z.string().min(1),
  }),
  z.object({
    source: z.literal('manual'),
    tenant: z.string().min(1),
  }),
]);
export type CreateAgentDraftBody = z.infer<typeof createAgentDraftBodySchema>;

export function sanitizeDraftId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `draft-${Date.now().toString(36)}`;
}

export function sanitizeEmployeeId(value: string): string {
  return sanitizeDraftId(value) || `employee-${Date.now().toString(36)}`;
}

export function touchDraft(
  draft: AgentDraft,
  patch: Partial<Omit<AgentDraft, 'id' | 'createdAt'>>,
): AgentDraft {
  const next: AgentDraft = {
    ...draft,
    ...patch,
    updatedAt: Date.now(),
  };
  return agentDraftSchema.parse(next);
}

export function getDraftRuntimeFingerprint(draft: AgentDraft): string {
  return JSON.stringify({
    tenant: draft.tenant,
    source: draft.source,
    input: draft.input ?? null,
    employee: draft.employee,
  });
}
