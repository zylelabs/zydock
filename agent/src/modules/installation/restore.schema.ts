import { z } from 'zod';

export const RESTORE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type RestoreRunStatus = (typeof RESTORE_RUN_STATUSES)[number];

export const startRestoreSchema = z.object({
  bundlePath: z.string().trim().min(1).max(4096),
  passphrase: z.string().min(12).max(200),
});

export type StartRestoreDTO = z.infer<typeof startRestoreSchema>;

export const restoreRunIdParamSchema = z.object({
  runId: z.string().min(1).max(128),
});

export type RestoreRunIdParam = z.infer<typeof restoreRunIdParamSchema>;

export const restoreRunStateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(RESTORE_RUN_STATUSES),
  bundlePath: z.string().default(''),
  installPath: z.string().default(''),
  startedAt: z.string().default(''),
  finishedAt: z.string().default(''),
  error: z.string().default(''),
  exitCode: z.number().default(0),
});

export type RestoreRunState = z.infer<typeof restoreRunStateSchema>;
