import { z } from 'zod';

export const startRestoreSchema = z.object({
  bundlePath: z.string().trim().min(1).max(4096),
  passphrase: z.string().min(12).max(200),
});

export type StartRestoreDTO = z.infer<typeof startRestoreSchema>;
