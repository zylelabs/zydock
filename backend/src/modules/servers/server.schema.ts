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

export const createServerSchema = z
  .object({
    // `type` is optional and defaults to `ssh` so existing clients keep working unchanged.
    type: z.enum(SERVER_TYPES).default('ssh'),
    name: z.string().trim().min(1).max(120),
    // Required only for `ssh` servers; a `local` server has no SSH credentials.
    ssh: sshCredentialsSchema.optional(),
    // Address the backend uses to reach the agent of a `local` server (e.g. `localhost` or
    // `host.docker.internal`). Ignored for `ssh` servers, where the agent lives on the SSH host.
    agentHost: z.string().trim().min(1).max(255).default('localhost'),
    agentPort: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'ssh' && !value.ssh) {
      ctx.addIssue({ code: 'custom', path: ['ssh'], message: 'SSH credentials are required' });
    }
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
