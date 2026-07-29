import { z } from 'zod';
import { projectIdParamSchema } from './project.schema';

export const DEFAULT_ENVIRONMENT_NAME = 'production';

export const environmentIdParamSchema = projectIdParamSchema.extend({
  environmentId: z.string().length(24),
});

export type EnvironmentIdParam = z.infer<typeof environmentIdParamSchema>;

export const createEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export type CreateEnvironmentDTO = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export type UpdateEnvironmentDTO = z.infer<typeof updateEnvironmentSchema>;
