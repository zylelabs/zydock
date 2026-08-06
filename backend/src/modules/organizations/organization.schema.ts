import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export type CreateOrganizationDTO = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
});

export type UpdateOrganizationDTO = z.infer<typeof updateOrganizationSchema>;
