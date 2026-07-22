import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';

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
    summary: 'Read a deployment, with the tail of its build log',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Deployment.', {
        type: 'object',
        properties: {
          deployment: {
            ...deploymentSchema,
            properties: {
              ...deploymentSchema.properties,
              buildLog: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      }),
      404: errorRes('Deployment not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
