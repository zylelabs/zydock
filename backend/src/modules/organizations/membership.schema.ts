import { z } from 'zod';

export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const;

export const INVITABLE_ROLES = ['admin', 'member'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ROLE_RANK: Record<OrganizationRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const organizationIdParamSchema = z.object({
  organizationId: z.string().length(24),
});

export type OrganizationIdParam = z.infer<typeof organizationIdParamSchema>;

export const memberParamSchema = organizationIdParamSchema.extend({
  userId: z.string().length(24),
});

export type MemberParam = z.infer<typeof memberParamSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(ORGANIZATION_ROLES),
});

export type UpdateMemberDTO = z.infer<typeof updateMemberSchema>;
