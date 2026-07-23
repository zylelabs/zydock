import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';

export const uploadIdParamSchema = z.object({
  upload: z.uuid(),
});

export type UploadIdParam = z.infer<typeof uploadIdParamSchema>;

export const volumeNameParamSchema = z.object({
  name: resourceNameSchema,
});

export type VolumeNameParam = z.infer<typeof volumeNameParamSchema>;

export const containerIdParamSchema = z.object({
  containerId: z.string().min(1).max(128),
});

export type ContainerIdParam = z.infer<typeof containerIdParamSchema>;

const commandSchema = z.array(z.string().min(1)).min(1).max(32);

export const archiveContainerSchema = z.object({
  command: commandSchema,
});

export type ArchiveContainerDTO = z.infer<typeof archiveContainerSchema>;

export const restoreVolumeSchema = z.object({
  upload: z.uuid(),
});

export type RestoreVolumeDTO = z.infer<typeof restoreVolumeSchema>;

export const restoreContainerSchema = restoreVolumeSchema.extend({
  command: commandSchema,
});

export type RestoreContainerDTO = z.infer<typeof restoreContainerSchema>;
