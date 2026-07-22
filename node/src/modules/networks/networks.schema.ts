import { z } from 'zod';
import { resourceNameSchema } from '../../utils/schema';

export const networkNameParamSchema = z.object({
  name: resourceNameSchema,
});

export type NetworkNameParam = z.infer<typeof networkNameParamSchema>;

export const createNetworkSchema = z.object({
  name: resourceNameSchema,
});

export type CreateNetworkDTO = z.infer<typeof createNetworkSchema>;
