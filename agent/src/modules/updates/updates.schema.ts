import { z } from 'zod';

export const UPDATE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type UpdateRunStatus = (typeof UPDATE_RUN_STATUSES)[number];

const gitRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Invalid git ref');

export const startUpdateSchema = z.object({
  channel: gitRefSchema.optional(),
  branch: gitRefSchema.optional(),
  ref: gitRefSchema.optional(),
  force: z.boolean().optional(),
});

export type StartUpdateDTO = z.infer<typeof startUpdateSchema>;

export const runIdParamSchema = z.object({
  runId: z.string().min(1).max(128),
});

export type RunIdParam = z.infer<typeof runIdParamSchema>;

export const updateRunStateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(UPDATE_RUN_STATUSES),
  from: z.string().default(''),
  to: z.string().default(''),
  channel: z.string().default(''),
  installPath: z.string().default(''),
  startedAt: z.string().default(''),
  finishedAt: z.string().default(''),
  error: z.string().default(''),
  exitCode: z.number().default(0),
});

export type UpdateRunState = z.infer<typeof updateRunStateSchema>;
