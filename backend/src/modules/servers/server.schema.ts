import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const SERVER_STATUSES = [
  'pending',
  'validating',
  'provisioning',
  'online',
  'offline',
  'failed',
] as const;

export type ServerStatus = (typeof SERVER_STATUSES)[number];

export const SERVER_TYPES = ['ssh', 'local'] as const;

export type ServerType = (typeof SERVER_TYPES)[number];

const sshCredentialsSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535).default(22),
    username: z.string().trim().min(1).max(64),
    privateKey: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    passphrase: z.string().min(1).optional(),
  })
  .refine(value => Boolean(value.privateKey ?? value.password), {
    message: 'Either privateKey or password must be provided',
    path: ['privateKey'],
  });

export const serverIdParamSchema = organizationIdParamSchema.extend({
  serverId: z.string().length(24),
});

export type ServerIdParam = z.infer<typeof serverIdParamSchema>;

export const createServerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ssh: sshCredentialsSchema,
  agentPort: z.coerce.number().int().min(1).max(65535).optional(),
});

export type CreateServerDTO = z.infer<typeof createServerSchema>;

export const updateServerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ssh: sshCredentialsSchema.optional(),
});

export type UpdateServerDTO = z.infer<typeof updateServerSchema>;

export const validateConnectionSchema = z.object({
  ssh: sshCredentialsSchema,
});

export type ValidateConnectionDTO = z.infer<typeof validateConnectionSchema>;
