import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware, requireSuperuser } from '../auth/auth.middleware';
import jobModel from './job.model';
import { queueDocs } from './queue.docs';
import { JobIdParam, jobIdParamSchema, ListJobsQuery, listJobsQuerySchema } from './queue.schema';
import { serializeJob } from './queue.service';

const { router, get, post, delete: del } = createRouter();

get(
  '/',
  queueDocs.list,
  authMiddleware,
  requireSuperuser,
  validator('query', listJobsQuerySchema),
  async (c: Context) => {
    const { status, type } = c.req.valid('query' as never) as ListJobsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await jobModel.paginate(
      { ...(status ? { status } : {}), ...(type ? { type } : {}) },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeJob) });
  },
);

get(
  '/:jobId',
  queueDocs.get,
  authMiddleware,
  requireSuperuser,
  validator('param', jobIdParamSchema),
  async (c: Context) => {
    const { jobId } = c.req.valid('param' as never) as JobIdParam;

    const job = await jobModel.findById(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return c.json({ job: serializeJob(job) });
  },
);

post(
  '/:jobId/retry',
  queueDocs.retry,
  authMiddleware,
  requireSuperuser,
  validator('param', jobIdParamSchema),
  async (c: Context) => {
    const { jobId } = c.req.valid('param' as never) as JobIdParam;

    const job = await jobModel.findById(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    if (job.status !== 'failed') {
      return c.json({ error: 'Only a failed job can be retried' }, 409);
    }

    await jobModel.updateOne(
      { _id: jobId },
      {
        $set: { status: 'pending', attempts: 0, runAt: new Date() },
        $unset: { finishedAt: '', startedAt: '', lockedBy: '' },
      },
    );

    return c.json({ job: serializeJob((await jobModel.findById(jobId))!) });
  },
);

del(
  '/:jobId',
  queueDocs.remove,
  authMiddleware,
  requireSuperuser,
  validator('param', jobIdParamSchema),
  async (c: Context) => {
    const { jobId } = c.req.valid('param' as never) as JobIdParam;

    const job = await jobModel.findById(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    if (job.status === 'running') {
      return c.json({ error: 'A running job cannot be removed' }, 409);
    }

    await jobModel.deleteOne({ _id: jobId });

    return c.json({ message: 'Job removed successfully' });
  },
);

export default router;
