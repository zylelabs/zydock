import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const applicationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    projectId: { type: 'string' },
    environmentId: { type: 'string' },
    serverId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    status: { type: 'string', enum: ['created', 'deploying', 'running', 'stopped', 'failed'] },
    git: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        repository: { type: 'string' },
        branch: { type: 'string' },
        dockerfilePath: { type: 'string' },
        buildContext: { type: 'string' },
        autoDeploy: { type: 'boolean' },
        hasToken: { type: 'boolean' },
      },
    },
    port: { type: 'integer' },
    variables: {
      type: 'array',
      description: 'Only the names: values never leave the platform through this endpoint.',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, secret: { type: 'boolean' } },
      },
    },
    volumes: { type: 'array', items: { type: 'object' } },
    networks: { type: 'array', items: { type: 'string' } },
    healthcheck: { type: 'object' },
    resources: { type: 'object' },
    restartPolicy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const applicationResponse = { type: 'object', properties: { application: applicationSchema } };

const variablesResponse = {
  type: 'object',
  properties: {
    variables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          secret: { type: 'boolean' },
        },
      },
    },
  },
};

export const applicationsDocs = {
  list: {
    tags: ['Applications'],
    summary: 'List the applications of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'projectId', in: 'query', schema: { type: 'string' } },
      { name: 'environmentId', in: 'query', schema: { type: 'string' } },
      { name: 'serverId', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Applications.', paginatedSchema(applicationSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Applications'],
    summary: 'Create an application',
    description:
      'The environment and the server must belong to the organization. Variable values and the ' +
      'git token are encrypted before being stored.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Application created.', applicationResponse),
      400: errorRes('Unknown environment or server.'),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Applications'],
    summary: 'Read an application',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application.', applicationResponse),
      404: errorRes('Application not found.'),
    },
  },
  update: {
    tags: ['Applications'],
    summary: 'Update an application',
    description:
      'Only the informed fields change. Sending `healthcheck: null` removes the healthcheck. ' +
      'Changes take effect on the next deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application updated.', applicationResponse),
      400: errorRes('Unknown server.'),
      404: errorRes('Application not found.'),
    },
  },
  remove: {
    tags: ['Applications'],
    summary: 'Remove an application',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Application removed successfully.'),
      404: errorRes('Application not found.'),
    },
  },
  listVariables: {
    tags: ['Applications'],
    summary: 'Read the environment variables of an application',
    description: 'Returns the decrypted values — the only endpoint that does.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Variables.', variablesResponse),
      403: errorRes('Permission denied.'),
      404: errorRes('Application not found.'),
    },
  },
  replaceVariables: {
    tags: ['Applications'],
    summary: 'Replace the environment variables of an application',
    description: 'Replaces the whole set; variables left out are removed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Variables replaced.', variablesResponse),
      404: errorRes('Application not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
