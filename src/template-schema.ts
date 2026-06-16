import { z } from 'zod';

export const templateEmployeeSchema = z.object({
  template: z.string(),
  role: z.string(),
});

export const collaborationFlowSchema = z.object({
  name: z.string(),
  path: z.array(z.string()),
});

export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  employees: z.array(templateEmployeeSchema),
  collaboration: z
    .object({
      flows: z.array(collaborationFlowSchema),
    })
    .optional(),
});

export type Template = z.infer<typeof templateSchema>;
export type TemplateEmployee = z.infer<typeof templateEmployeeSchema>;
