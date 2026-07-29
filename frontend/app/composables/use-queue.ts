import type { Paginated } from '~/composables/use-api';

export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface JobFilter {
  status?: JobStatus;
  type?: string;
}

export const useQueue = () => {
  const api = useApi();

  const list = (filter: JobFilter = {}) =>
    api.get<Paginated<Job>>('/queue', { query: { size: 100, ...filter } });
  const retry = (jobId: string) => api.post<{ job: Job }>(`/queue/${jobId}/retry`);
  const remove = (jobId: string) => api.del<{ message: string }>(`/queue/${jobId}`);

  return { list, retry, remove };
};
