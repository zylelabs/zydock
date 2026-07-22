interface JobData {
  type: string;
  payload: Record<string, unknown>;
  status: import('./queue.schema').JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  lockedBy?: string;
  lastError?: string;
}

type Job = BaseDocument<JobData>;
