import { z } from 'zod';

export const SNAPSHOT_STATUSES = ['running', 'completed', 'failed'] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const createSnapshotSchema = z.object({
  passphrase: z.string().min(12).max(200),
  includeApplicationData: z.boolean().optional(),
});

export type CreateSnapshotDTO = z.infer<typeof createSnapshotSchema>;

export const snapshotIdParamSchema = z.object({
  snapshotId: z.string().length(24),
});

export type SnapshotIdParam = z.infer<typeof snapshotIdParamSchema>;
