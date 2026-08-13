import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';

const templateSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'integer' },
    name: { type: 'string' },
    tagline: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    icon: { type: 'string' },
    website: { type: 'string' },
    documentation: { type: 'string' },
    license: { type: 'string' },
    author: { type: 'string' },
    origin: { type: 'string', enum: ['official', 'community'] },
    expose: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        port: { type: 'integer' },
        domain: { type: 'boolean' },
      },
    },
    databases: {
      type: 'array',
      items: {
        type: 'object',
        properties: { service: { type: 'string' }, engine: { type: 'string' } },
      },
    },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['text', 'password', 'number', 'boolean', 'select'] },
          options: { type: 'array', items: { type: 'string' } },
          required: { type: 'boolean' },
        },
      },
    },
    secrets: {
      type: 'array',
      description: 'Only the key and the generator: values do not exist at the catalog level.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          generate: { type: 'string', enum: ['password', 'hex32', 'uuid'] },
        },
      },
    },
  },
};

const templateResponse = { type: 'object', properties: { template: templateSchema } };

export const templatesDocs = {
  list: {
    tags: ['Templates'],
    summary: 'List the marketplace catalog',
    description: 'Read-only, embedded catalog. Filters by free-text search and category.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'category', in: 'query', schema: { type: 'string' } },
    ],
    responses: { 200: jsonRes('Templates.', paginatedSchema(templateSchema)) },
  },
  get: {
    tags: ['Templates'],
    summary: 'Read a template',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Template.', templateResponse),
      404: errorRes('Template not found.'),
    },
  },
  versions: {
    tags: ['Templates'],
    summary: 'List the selectable versions of a template',
    description:
      'Union of the curated `versions.available` list (always present, `origin: "catalog"`) with ' +
      'tags read from the image registry when the template declares `versions.registry` ' +
      '(`origin: "registry"`), sorted by semantic version when every tag parses as one, otherwise ' +
      'by recency. `search` filters both before the `versions.registry.limit` cutoff is applied. A ' +
      'registry outage never fails the request: it falls back to the curated list with `degraded` ' +
      'set.',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
    responses: {
      200: jsonRes('Version listing.', {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['catalog', 'registry', 'mixed'] },
          versions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
                updatedAt: { type: 'string', format: 'date-time' },
                origin: { type: 'string', enum: ['catalog', 'registry'] },
              },
            },
          },
          fetchedAt: { type: 'string', format: 'date-time' },
          degraded: {
            type: 'object',
            properties: { reason: { type: 'string' } },
          },
        },
      }),
      400: errorRes('The template has no selectable versions.'),
      404: errorRes('Template not found.'),
    },
  },
  deploy: {
    tags: ['Templates'],
    summary: 'Instantiate a template as an application',
    description:
      'Generates the declared secrets on the server, builds the `.env` from inputs + secrets + ' +
      '`ZYDOCK_*`, and creates a `source: "compose"` application with `origin.templateId` set. ' +
      'With `deployNow: true` (the default) it also queues the first deployment, same as ' +
      '`POST /organizations/:organizationId/applications/:applicationId/deploy`. Admin or owner ' +
      'of `organizationId`. Fails fast if the server has no Compose plugin detected yet; if a step ' +
      'fails after the application was created, it is rolled back.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Application created (and deployment queued, unless `deployNow: false`).', {
        type: 'object',
        properties: { application: { type: 'object' }, deployment: { type: 'object' } },
      }),
      400: errorRes('Invalid inputs, or an environment/server outside the organization.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Organization or template not found.'),
      409: errorRes('The server has no Docker Compose plugin detected yet.'),
    },
  },
} satisfies Record<string, DocOptions>;
