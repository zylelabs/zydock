import { z } from 'zod';

export const imageReferenceSchema = z.object({
  reference: z.string().min(1).max(512),
});

export type ImageReferenceDTO = z.infer<typeof imageReferenceSchema>;
