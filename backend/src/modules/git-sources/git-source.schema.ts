import { z } from 'zod';
import { organizationIdParamSchema } from '../organizations/membership.schema';

export const GIT_SOURCE_STATUSES = ['pending', 'active'] as const;

export type GitSourceStatus = (typeof GIT_SOURCE_STATUSES)[number];

export const gitSourceIdParamSchema = organizationIdParamSchema.extend({
  gitSourceId: z.string().length(24),
});

export type GitSourceIdParam = z.infer<typeof gitSourceIdParamSchema>;

export const gitSourceInstallationParamSchema = gitSourceIdParamSchema.extend({
  installationId: z.string().trim().min(1),
});

export type GitSourceInstallationParam = z.infer<typeof gitSourceInstallationParamSchema>;

export const createManifestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organization: z.string().trim().min(1).max(120).optional(),
});

export type CreateManifestDTO = z.infer<typeof createManifestSchema>;

export const manifestCallbackSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export type ManifestCallbackDTO = z.infer<typeof manifestCallbackSchema>;
