import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const environmentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    projectId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const environmentResponse = { type: 'object', properties: { environment: environmentSchema } };

export const environmentDocs = {
  list: {
    tags: ['Environments'],
    summary: 'List the environments of a project',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Environments.', paginatedSchema(environmentSchema)),
      404: errorRes('Project not found.'),
    },
  },
  create: {
    tags: ['Environments'],
    summary: 'Create an environment',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Environment created.', environmentResponse),
      404: errorRes('Project not found.'),
    },
  },
  get: {
    tags: ['Environments'],
    summary: 'Read an environment',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Environment.', environmentResponse),
      404: errorRes('Environment not found.'),
    },
  },
  update: {
    tags: ['Environments'],
    summary: 'Rename an environment',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Environment updated.', environmentResponse),
      404: errorRes('Environment not found.'),
    },
  },
  remove: {
    tags: ['Environments'],
    summary: 'Remove an environment',
    description:
      'Removes the applications of the environment as well. The last environment of a project ' +
      'cannot be removed — a project always has somewhere to deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Environment removed successfully.'),
      409: errorRes('The project would be left without any environment.'),
      404: errorRes('Environment not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
