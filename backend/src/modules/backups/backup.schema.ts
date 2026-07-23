import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const BACKUP_TYPES = ['volume', 'database', 'configuration'] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];

export const BACKUP_STATUSES = ['running', 'completed', 'failed'] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const backupIdParamSchema = organizationIdParamSchema.extend({
  backupId: z.string().length(24),
});

export type BackupIdParam = z.infer<typeof backupIdParamSchema>;

export const listBackupsQuerySchema = z.object({
  type: z.enum(BACKUP_TYPES).optional(),
  status: z.enum(BACKUP_STATUSES).optional(),
  databaseId: z.string().length(24).optional(),
  serverId: z.string().length(24).optional(),
});

export type ListBackupsQuery = z.infer<typeof listBackupsQuerySchema>;

/** A volume name as Docker accepts it — the same shape the agent validates on its side. */
const volumeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid volume name');

export const createBackupSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('database'),
    databaseId: z.string().length(24),
  }),
  z.object({
    type: z.literal('volume'),
    serverId: z.string().length(24),
    volumeName: volumeNameSchema,
    /** Only context: which application the volume belongs to, when it belongs to one. */
    applicationId: z.string().length(24).optional(),
  }),
  z.object({
    type: z.literal('configuration'),
  }),
]);

export type CreateBackupDTO = z.infer<typeof createBackupSchema>;
