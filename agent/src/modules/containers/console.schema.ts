import { z } from 'zod';

export const CONSOLE_MODES = ['shell', 'attach'] as const;

export const consoleModeSchema = z.enum(CONSOLE_MODES);

export const consoleControlSchema = z.object({
  type: z.literal('resize'),
  columns: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});

export type ConsoleControlDTO = z.infer<typeof consoleControlSchema>;
