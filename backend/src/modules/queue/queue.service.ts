import { randomUUID } from 'node:crypto';
import config from '../../config';
import { logError, logInfo, logWarn } from '../../utils/logger';
import jobModel from './job.model';

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/**
 * Handlers register themselves, the same way WebSocket topic authorizers do
 * ([ADR-0018](../../../docs-ia/decisions.md)): the queue never imports a business module.
 */
const handlers = new Map<string, JobHandler>();

const workerId = randomUUID();

let timer: ReturnType<typeof setInterval> | undefined;
let running = 0;

export const registerJobHandler = (type: string, handler: JobHandler) => {
  handlers.set(type, handler);
};

export const enqueueJob = (
  type: string,
  payload: Record<string, unknown>,
  options: { maxAttempts?: number; runAt?: Date } = {},
) =>
  jobModel.create({
    type,
    payload,
    status: 'pending',
    attempts: 0,
    maxAttempts: options.maxAttempts ?? config.queue.maxAttempts,
    runAt: options.runAt ?? new Date(),
  });

/** Exponential backoff, so a failing dependency is not hammered every second. */
const nextAttemptAt = (attempts: number) =>
  new Date(Date.now() + config.queue.retryDelayMs * 2 ** (attempts - 1));

/**
 * Claims one job atomically: the `findOneAndUpdate` is what keeps two workers — or two backend
 * instances — from running the same job.
 */
const claimJob = () =>
  jobModel.findOneAndUpdate(
    { status: 'pending', runAt: { $lte: new Date() } },
    {
      $set: { status: 'running', startedAt: new Date(), lockedBy: workerId },
      $inc: { attempts: 1 },
    },
    { sort: { runAt: 1 }, new: true },
  );

/** A worker that dies leaves its job `running` forever; this puts it back in the queue. */
const requeueStaleJobs = async () => {
  const threshold = new Date(Date.now() - config.queue.jobTimeoutSeconds * 1000);

  const result = await jobModel.updateMany(
    { status: 'running', startedAt: { $lt: threshold } },
    {
      $set: {
        status: 'pending',
        runAt: new Date(),
        lastError: 'The worker did not finish the job in time',
      },
      $unset: { lockedBy: '', startedAt: '' },
    },
  );

  if (result.modifiedCount) {
    logWarn('Stale jobs requeued', { jobs: result.modifiedCount });
  }
};

const failJob = async (job: Job, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  await jobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: exhausted ? 'failed' : 'pending',
        lastError: message,
        ...(exhausted ? { finishedAt: new Date() } : { runAt: nextAttemptAt(job.attempts) }),
      },
      $unset: { lockedBy: '' },
    },
  );

  logError('Job failed', error, {
    job: String(job._id),
    type: job.type,
    attempt: job.attempts,
    willRetry: !exhausted,
  });
};

const runJob = async (job: Job) => {
  const handler = handlers.get(job.type);

  if (!handler) {
    await failJob(job, new Error(`No handler registered for job type "${job.type}"`));
    return;
  }

  try {
    await handler(job.payload, job);

    await jobModel.updateOne(
      { _id: job._id },
      { $set: { status: 'completed', finishedAt: new Date() }, $unset: { lockedBy: '' } },
    );
  } catch (error) {
    await failJob(job, error);
  }
};

/** One pass: recovers abandoned jobs, then fills the free slots up to the configured concurrency. */
export const drainQueue = async () => {
  await requeueStaleJobs();

  const started: Promise<void>[] = [];

  while (running < config.queue.concurrency) {
    const job = await claimJob();

    if (!job) {
      break;
    }

    running += 1;

    started.push(
      runJob(job).finally(() => {
        running -= 1;
      }),
    );
  }

  return started;
};

export const startWorker = () => {
  if (timer || !config.queue.enabled) {
    return;
  }

  timer = setInterval(() => {
    drainQueue().catch(error => logError('Queue worker cycle failed', error));
  }, config.queue.pollIntervalMs);

  logInfo('Queue worker started', {
    worker: workerId,
    concurrency: config.queue.concurrency,
    pollIntervalMs: config.queue.pollIntervalMs,
  });
};

export const stopWorker = () => {
  if (!timer) {
    return;
  }

  clearInterval(timer);
  timer = undefined;

  logInfo('Queue worker stopped', { worker: workerId });
};

export const serializeJob = (job: Job) => ({
  id: String(job._id),
  type: job.type,
  status: job.status,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  runAt: job.runAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  lastError: job.lastError,
  createdAt: job.createdAt,
});
