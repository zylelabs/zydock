import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';

export const createInstallationBundleSchema = z.object({
  publicIp: z.string().trim().max(255).optional(),
  domain: z.string().trim().max(255).optional(),
  includeApplicationData: z.boolean().optional(),
  volumes: z.array(resourceNameSchema).max(500).optional(),
});

export type CreateInstallationBundleDTO = z.infer<typeof createInstallationBundleSchema>;
