import { z } from 'zod';

export const INSTALLATION_ROLES = ['active', 'standby'] as const;

export type InstallationRole = (typeof INSTALLATION_ROLES)[number];

export const roleChangeSchema = z
  .object({
    force: z.boolean(),
    note: z.string().trim().max(500),
  })
  .partial();

export type RoleChangeDTO = z.infer<typeof roleChangeSchema>;
