import { z } from 'zod';

export const COMPOSE_FILE_NAMES = ['docker-compose.yml', 'zydock.override.yml', '.env'] as const;

export type ComposeFileNameDTO = (typeof COMPOSE_FILE_NAMES)[number];

export const projectParamSchema = z.object({
  project: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Invalid project id'),
});

export type ProjectParam = z.infer<typeof projectParamSchema>;

const composeFileSchema = z.object({
  name: z.enum(COMPOSE_FILE_NAMES),
  content: z.string().max(1_000_000),
});

export const writeComposeSchema = z
  .object({
    files: z.array(composeFileSchema).min(1).max(COMPOSE_FILE_NAMES.length),
  })
  .refine(({ files }) => new Set(files.map(file => file.name)).size === files.length, {
    message: 'Duplicate file name',
    path: ['files'],
  })
  .refine(({ files }) => files.some(file => file.name === 'docker-compose.yml'), {
    message: 'docker-compose.yml is required',
    path: ['files'],
  });

export type WriteComposeDTO = z.infer<typeof writeComposeSchema>;

export const restartComposeQuerySchema = z.object({
  service: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid service name')
    .optional(),
});

export type RestartComposeQuery = z.infer<typeof restartComposeQuerySchema>;
