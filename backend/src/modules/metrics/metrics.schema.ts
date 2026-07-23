import { z } from 'zod';
import { serverIdParamSchema } from '../servers/server.schema';
import { applicationIdParamSchema } from '../applications/application.schema';

export { serverIdParamSchema, applicationIdParamSchema };

export const historyQuerySchema = z.object({
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
