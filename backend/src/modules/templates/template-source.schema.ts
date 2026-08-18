import { z } from 'zod';

const refSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'The ref has characters that git does not accept');

export const createTemplateSourceSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .url()
    .refine(value => value.startsWith('https://'), 'Only "https://" repository URLs are supported'),
  ref: refSchema.default('main'),
});

export type CreateTemplateSourceDTO = z.infer<typeof createTemplateSourceSchema>;

export const templateSourceIdParamSchema = z.object({
  templateSourceId: z.string().length(24),
});

export type TemplateSourceIdParam = z.infer<typeof templateSourceIdParamSchema>;
