import { z } from 'zod';

/** Docker accepts `[a-zA-Z0-9][a-zA-Z0-9_.-]*` as the name of a network or a volume. */
export const resourceNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid name');
