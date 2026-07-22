import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const jobSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
    attempts: { type: 'integer' },
    maxAttempts: { type: 'integer' },
    runAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: { type: 'string', format: 'date-time' },
    lastError: { type: 'string' },
  },
};

export const queueDocs = {
  list: {
    tags: ['Queue'],
    summary: 'List the jobs of the platform',
    description: 'Superuser only: the queue crosses every organization.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'status', in: 'query', schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Jobs.', paginatedSchema(jobSchema)),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Queue'],
    summary: 'Read a job',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Job.', { type: 'object', properties: { job: jobSchema } }),
      404: errorRes('Job not found.'),
    },
  },
  retry: {
    tags: ['Queue'],
    summary: 'Put a failed job back in the queue',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Job requeued.', { type: 'object', properties: { job: jobSchema } }),
      409: errorRes('Only a failed job can be retried.'),
      404: errorRes('Job not found.'),
    },
  },
  remove: {
    tags: ['Queue'],
    summary: 'Remove a job from the history',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Job removed successfully.'),
      409: errorRes('A running job cannot be removed.'),
      404: errorRes('Job not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
