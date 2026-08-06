import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';

const logEntrySchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    stream: { type: 'string', enum: ['stdout', 'stderr'] },
    level: { type: 'string', enum: ['error', 'warn', 'info'] },
  },
};

const logParameters = [
  { name: 'search', in: 'query' as const, schema: { type: 'string' } },
  {
    name: 'level',
    in: 'query' as const,
    schema: { type: 'string', enum: ['error', 'warn', 'info'] },
  },
  { name: 'tail', in: 'query' as const, schema: { type: 'integer', default: 200 } },
];

const deploymentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    applicationId: { type: 'string' },
    serverId: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed'] },
    trigger: { type: 'string', enum: ['manual', 'webhook'] },
    branch: { type: 'string' },
    commit: {
      type: 'object',
      properties: {
        sha: { type: 'string' },
        message: { type: 'string' },
        author: { type: 'string' },
        committedAt: { type: 'string', format: 'date-time' },
      },
    },
    imageTag: { type: 'string' },
    containerId: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string', enum: ['clone', 'build', 'container', 'proxy', 'healthcheck'] },
          status: { type: 'string', enum: ['ok', 'failed', 'skipped'] },
          detail: { type: 'string' },
          durationMs: { type: 'integer' },
        },
      },
    },
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: { type: 'string', format: 'date-time' },
    durationMs: { type: 'integer' },
    error: { type: 'string' },
  },
};

export const deploymentsDocs = {
  list: {
    tags: ['Deployments'],
    summary: 'List the deployments of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'applicationId', in: 'query', schema: { type: 'string' } },
      { name: 'status', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Deployments.', paginatedSchema(deploymentSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  get: {
    tags: ['Deployments'],
    summary: 'Read a deployment, with the tail of its log',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Deployment.', {
        type: 'object',
        properties: {
          deployment: {
            ...deploymentSchema,
            properties: {
              ...deploymentSchema.properties,
              log: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      }),
      404: errorRes('Deployment not found.'),
    },
  },
  logs: {
    tags: ['Logs'],
    summary: 'Read the log of a deploy',
    description:
      'The full output of a deploy — clone, build and container boot, in a single ' +
      'chronological stream, each line prefixed with its step — as classified entries, the ' +
      "same shape as an application's runtime logs, so `search`, `level` and download work the " +
      'same way. Lines carry no timestamp, so `since`/`until`/`stream` do not apply; `tail` ' +
      'keeps the last lines.',
    security: bearerOrApiKeyAuth,
    parameters: logParameters,
    responses: {
      200: jsonRes('Deployment log.', {
        type: 'object',
        properties: {
          deploymentId: { type: 'string' },
          entries: { type: 'array', items: logEntrySchema },
        },
      }),
      404: errorRes('Deployment not found.'),
    },
  },
  logsDownload: {
    tags: ['Logs'],
    summary: 'Download the log of a deploy',
    description: 'Same filters as the listing, returned as a `text/plain` attachment.',
    security: bearerOrApiKeyAuth,
    parameters: logParameters,
    responses: {
      200: {
        description: 'Build log file.',
        content: { 'text/plain': { schema: { type: 'string' } } },
      },
      404: errorRes('Deployment not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
