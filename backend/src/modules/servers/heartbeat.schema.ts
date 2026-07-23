import { z } from 'zod';

export const heartbeatSchema = z.object({
  version: z.string().min(1).max(32),
  metrics: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      memoryUsedMb: z.number().min(0).optional(),
      memoryTotalMb: z.number().min(0).optional(),
      diskUsedGb: z.number().min(0).optional(),
      diskTotalGb: z.number().min(0).optional(),
      networkRxBytes: z.number().min(0).optional(),
      networkTxBytes: z.number().min(0).optional(),
      uptimeSeconds: z.number().min(0).optional(),
      containersRunning: z.number().int().min(0).optional(),
      containersTotal: z.number().int().min(0).optional(),
    })
    .optional(),
  dockerVersion: z.string().max(64).optional(),
});

export type HeartbeatDTO = z.infer<typeof heartbeatSchema>;
