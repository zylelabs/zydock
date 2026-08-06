import { z } from 'zod';

export const MAX_TAIL = 5000;
export const DEFAULT_TAIL = 500;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const accessQuerySchema = z.object({
  host: z.string().min(1).max(253).optional(),
  since: z.string().optional(),
  tail: z.coerce.number().int().min(1).max(MAX_TAIL).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type AccessQueryDTO = z.infer<typeof accessQuerySchema>;

export const accessStreamQuerySchema = accessQuerySchema.omit({ page: true, size: true });

export type AccessStreamQueryDTO = z.infer<typeof accessStreamQuerySchema>;
