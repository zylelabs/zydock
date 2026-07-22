import { z } from 'zod';

export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobIdParamSchema = z.object({
  jobId: z.string().length(24),
});

export type JobIdParam = z.infer<typeof jobIdParamSchema>;

export const listJobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.string().trim().min(1).max(64).optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
