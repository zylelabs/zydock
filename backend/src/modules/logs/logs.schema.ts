import { z } from 'zod';
import { LOG_LEVELS } from './log.filter';

export const logsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  stream: z.enum(['stdout', 'stderr']).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  since: z.string().trim().min(1).max(64).optional(),
  until: z.string().trim().min(1).max(64).optional(),
  tail: z.coerce.number().int().min(1).max(5000).default(200),
});

export type LogsQuery = z.infer<typeof logsQuerySchema>;
