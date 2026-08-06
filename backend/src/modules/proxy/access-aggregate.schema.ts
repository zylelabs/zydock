import { z } from 'zod';

export const MAX_STATS_MINUTES = 7 * 24 * 60;
export const DEFAULT_STATS_MINUTES = 60;
export const MAX_STATS_BUCKETS_PER_BATCH = 500;

const counterSchema = z.number().int().min(0);

export const accessAggregateBucketSchema = z.object({
  host: z.string().min(1).max(253),
  minute: z.string(),
  total: counterSchema,
  status2xx: counterSchema,
  status3xx: counterSchema,
  status4xx: counterSchema,
  status5xx: counterSchema,
  statusOther: counterSchema,
  durationSumMs: counterSchema,
  durationMaxMs: counterSchema,
  durationLe100: counterSchema,
  durationLe300: counterSchema,
  durationLe1000: counterSchema,
  durationLe3000: counterSchema,
  durationGt3000: counterSchema,
});

export type AccessAggregateBucketDTO = z.infer<typeof accessAggregateBucketSchema>;

export const accessAggregateIngestSchema = z.object({
  buckets: z.array(accessAggregateBucketSchema).max(MAX_STATS_BUCKETS_PER_BATCH),
});

export type AccessAggregateIngestDTO = z.infer<typeof accessAggregateIngestSchema>;

export const accessStatsQuerySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(MAX_STATS_MINUTES).optional(),
});

export type AccessStatsQueryDTO = z.infer<typeof accessStatsQuerySchema>;
