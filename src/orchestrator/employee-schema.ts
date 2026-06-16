import { z } from 'zod';

const scheduleTriggerSchema = z.object({
  type: z.enum(['cron', 'interval', 'once', 'event']),
  value: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
}).refine(t => t.type !== 'event' || (t.value && t.value.length > 0), {
  message: 'Event trigger must have a non-empty value',
  path: ['value'],
});

const scheduleSchema = z.object({
  triggers: z.array(scheduleTriggerSchema).default([]),
});

const retrySchema = z.object({
  maxRetries: z.number().int().min(0).default(3),
  maxModelRetries: z.number().int().min(0).default(5),
});

export const employeeDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().default(''),
  model: z.string().default(''),
  systemPrompt: z.string().default(''),
  maxTurns: z.number().int().min(1).default(50),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  workspace: z.string().default(''),
  role: z.string().default(''),
  schedule: scheduleSchema.optional(),
  allowedTargets: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]).describe(
    'Keywords describing what this agent can solve (e.g. "合同", "发票", "维修"). Used by the dispatcher for routing.',
  ),
  retry: retrySchema.optional(),
  channel: z.enum(['dingtalk', 'feishu']).optional(),
  channelConfig: z.record(z.string(), z.unknown()).optional(),
  humanUserId: z.string().optional(),
  template: z.string().optional().describe('Source template (e.g. "med-device/sales")'),
  oneLiner: z.string().optional().describe('Self-intro one-liner'),
  // Fields from DemoAgent:
  source: z.enum(['generated', 'prepopulated', 'forked']).default('prepopulated'),
  createdAt: z.number().default(() => Date.now()),
});

export type EmployeeDefinition = z.infer<typeof employeeDefinitionSchema>;
