import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';

export const volumeNameParamSchema = z.object({
  name: resourceNameSchema,
});

export type VolumeNameParam = z.infer<typeof volumeNameParamSchema>;

export const volumePathQuerySchema = z.object({
  path: z.string().max(4096).optional().default(''),
});

export type VolumePathQuery = z.infer<typeof volumePathQuerySchema>;

export const createDirectorySchema = z.object({
  path: z.string().min(1).max(4096),
});

export type CreateDirectoryDTO = z.infer<typeof createDirectorySchema>;
