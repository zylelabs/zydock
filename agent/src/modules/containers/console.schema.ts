import { z } from 'zod';

export const consoleControlSchema = z.object({
  type: z.literal('resize'),
  columns: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});

export type ConsoleControlDTO = z.infer<typeof consoleControlSchema>;
