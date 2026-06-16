import { z } from 'zod';

export const riskLevelSchema = z.enum(['read', 'internal_write', 'external', 'destructive']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const toolDefSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  riskLevel: riskLevelSchema.default('read'),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export type ToolDef = z.infer<typeof toolDefSchema>;

export const skillToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  riskLevel: riskLevelSchema.default('read'),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export const skillToolManifestSchema = z.object({
  tools: z.array(skillToolSchema).default([]),
});

export type SkillToolDef = z.infer<typeof skillToolSchema>;
export type SkillToolManifest = z.infer<typeof skillToolManifestSchema>;

export const serverConfigSchema = z.object({
  entry: z.string(),
  python: z.string().optional(),
}).strict();

export const toolManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tools: z.array(toolDefSchema).min(0),
  server: serverConfigSchema.optional(),
}).strict();

export type ToolManifest = z.infer<typeof toolManifestSchema>;

export const appJsonSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  budget: z.object({
    dailyTokenLimit: z.number().optional(),
    maxTokensPerQuery: z.number().optional(),
  }).optional(),
  outcomeSignals: z.object({
    positive: z.array(z.string()).optional(),
    negative: z.array(z.string()).optional(),
  }).optional(),
  followup: z.object({
    enabled: z.boolean().optional(),
    delayDays: z.number().optional(),
    prompt: z.string().optional(),
  }).optional(),
  contextCompaction: z.object({
    enabled: z.boolean().optional(),
    threshold: z.number().optional(),
    keepRecent: z.number().optional(),
    summaryPrompt: z.string().optional(),
  }).optional(),
}).strict();

export type AppJson = z.infer<typeof appJsonSchema>;
