import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const projectIdParamSchema = organizationIdParamSchema.extend({
  projectId: z.string().length(24),
});

export type ProjectIdParam = z.infer<typeof projectIdParamSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export type CreateProjectDTO = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});

export type UpdateProjectDTO = z.infer<typeof updateProjectSchema>;
