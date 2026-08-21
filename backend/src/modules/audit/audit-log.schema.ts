import { z } from 'zod';

export const AUDIT_LOG_ACTIONS = [
  'console',
  'volume.read',
  'volume.write',
  'volume.remove',
] as const;

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export const listAuditLogQuerySchema = z.object({
  serverId: z.string().length(24).optional(),
  action: z.enum(AUDIT_LOG_ACTIONS).optional(),
});

export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;
