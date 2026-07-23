import { z } from 'zod';
// Imported from the contract, not the index: the index re-exports it as a type only.
import { DATABASE_ENGINES } from '../../providers/database/database.contract';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export type DatabaseEngineName = (typeof DATABASE_ENGINES)[number];

export const DATABASE_INSTANCE_STATUSES = [
  'provisioning',
  'running',
  'stopped',
  'failed',
  'unknown',
] as const;

export type DatabaseInstanceStatus = (typeof DATABASE_INSTANCE_STATUSES)[number];

/** Sensible current image tag per engine, used when the request does not pin a version. */
export const DEFAULT_VERSIONS: Record<DatabaseEngineName, string> = {
  postgresql: '16-alpine',
  mysql: '8',
  mongodb: '7',
  redis: '7-alpine',
};

export const databaseIdParamSchema = organizationIdParamSchema.extend({
  databaseId: z.string().length(24),
});

export type DatabaseIdParam = z.infer<typeof databaseIdParamSchema>;

export const listDatabasesQuerySchema = z.object({
  serverId: z.string().length(24).optional(),
  engine: z.enum(DATABASE_ENGINES).optional(),
});

export type ListDatabasesQuery = z.infer<typeof listDatabasesQuerySchema>;

export const createDatabaseSchema = z.object({
  serverId: z.string().length(24),
  name: z.string().trim().min(1).max(120),
  engine: z.enum(DATABASE_ENGINES),
  version: z.string().trim().min(1).max(64).optional(),
  environment: z.record(z.string(), z.string()).optional(),
});

export type CreateDatabaseDTO = z.infer<typeof createDatabaseSchema>;

export const removeDatabaseQuerySchema = z.object({
  removeData: z.coerce.boolean().optional(),
});

export type RemoveDatabaseQuery = z.infer<typeof removeDatabaseQuerySchema>;
