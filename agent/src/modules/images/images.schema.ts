import { z } from 'zod';

export const imageReferenceSchema = z.object({
  reference: z.string().min(1).max(512),
});

export type ImageReferenceDTO = z.infer<typeof imageReferenceSchema>;

export const buildImageSchema = z.object({
  tag: z.string().min(1).max(256),
  contextPath: z.string().min(1).max(1024),
  dockerfilePath: z.string().min(1).max(1024).optional(),
  buildArgs: z.record(z.string(), z.string()).optional(),
  buildSecrets: z.record(z.string(), z.string()).optional(),
  injectBuildArgs: z.boolean().default(false),
  target: z.string().min(1).max(128).optional(),
});

export type BuildImageDTO = z.infer<typeof buildImageSchema>;
