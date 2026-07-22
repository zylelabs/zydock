import { z } from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color such as #1d4ed8');

export const brandingSchema = z.object({
  logo: z.string().max(2048).optional(),
  favicon: z.string().max(2048).optional(),
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  branding: brandingSchema.optional(),
});

export type CreateOrganizationDTO = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  branding: brandingSchema.optional(),
});

export type UpdateOrganizationDTO = z.infer<typeof updateOrganizationSchema>;
