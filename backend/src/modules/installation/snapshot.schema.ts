import { z } from 'zod';

export const SNAPSHOT_STATUSES = ['running', 'completed', 'failed'] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const SNAPSHOT_ORIGINS = ['generated', 'uploaded'] as const;

export type SnapshotOrigin = (typeof SNAPSHOT_ORIGINS)[number];

export const createSnapshotSchema = z.object({
  passphrase: z.string().min(12).max(200),
  includeApplicationData: z.boolean().optional(),
});

export type CreateSnapshotDTO = z.infer<typeof createSnapshotSchema>;

export const snapshotIdParamSchema = z.object({
  snapshotId: z.string().length(24),
});

export type SnapshotIdParam = z.infer<typeof snapshotIdParamSchema>;

export const uploadSnapshotQuerySchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
});

export type UploadSnapshotQuery = z.infer<typeof uploadSnapshotQuerySchema>;
