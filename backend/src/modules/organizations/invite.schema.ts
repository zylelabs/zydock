import { z } from 'zod';
import { INVITABLE_ROLES, organizationIdParamSchema } from './membership.schema';

export const createInviteSchema = z.object({
  email: z.email().toLowerCase(),
  role: z.enum(INVITABLE_ROLES).default('member'),
});

export type CreateInviteDTO = z.infer<typeof createInviteSchema>;

export const inviteParamSchema = organizationIdParamSchema.extend({
  inviteId: z.string().length(24),
});

export type InviteParam = z.infer<typeof inviteParamSchema>;

export const inviteTokenSchema = z.object({
  token: z.string().min(1),
});

export type InviteTokenDTO = z.infer<typeof inviteTokenSchema>;
