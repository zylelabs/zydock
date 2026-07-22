import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export type CreateApiKeyDTO = z.infer<typeof createApiKeySchema>;
