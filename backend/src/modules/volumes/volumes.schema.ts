import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';
import { serverIdParamSchema } from '../servers/server.schema';

export const volumeNameParamSchema = serverIdParamSchema.extend({
  name: resourceNameSchema,
});

export type VolumeNameParam = z.infer<typeof volumeNameParamSchema>;

export const createVolumeSchema = z.object({
  name: resourceNameSchema,
});

export type CreateVolumeDTO = z.infer<typeof createVolumeSchema>;

const isSafeVolumePath = (value: string) => {
  if (value.includes('\0')) {
    return false;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return false;
  }

  const segments = trimmed.split(/[\\/]+/).filter(segment => segment.length > 0 && segment !== '.');

  return !segments.some(segment => segment === '..');
};

export const volumePathQuerySchema = z.object({
  path: z.string().max(4096).optional().default('').refine(isSafeVolumePath, 'Invalid path'),
});

export type VolumePathQuery = z.infer<typeof volumePathQuerySchema>;

export const createVolumeDirectorySchema = z.object({
  path: z.string().min(1).max(4096).refine(isSafeVolumePath, 'Invalid path'),
});

export type CreateVolumeDirectoryDTO = z.infer<typeof createVolumeDirectorySchema>;
