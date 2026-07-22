import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';

export const volumeNameParamSchema = z.object({
  name: resourceNameSchema,
});

export type VolumeNameParam = z.infer<typeof volumeNameParamSchema>;

export const createVolumeSchema = z.object({
  name: resourceNameSchema,
});

export type CreateVolumeDTO = z.infer<typeof createVolumeSchema>;
