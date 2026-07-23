import { z } from 'zod';

export const workspaceParamSchema = z.object({
  workspace: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Invalid workspace id'),
});

export type WorkspaceParam = z.infer<typeof workspaceParamSchema>;

export const cloneSchema = z.object({
  /** Already authenticated by the backend when the repository is private. */
  url: z.string().url().max(2048),
  branch: z.string().trim().min(1).max(200),
  workspace: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Invalid workspace id'),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, 'Invalid commit sha')
    .optional(),
});

export type CloneDTO = z.infer<typeof cloneSchema>;
