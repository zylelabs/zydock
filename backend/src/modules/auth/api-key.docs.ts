import type { DocOptions } from 'hono-route-docs';
import {
  bearerAuth,
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const apiKeySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    prefix: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const apiKeyDocs = {
  create: {
    tags: ['API Keys'],
    summary: 'Create an API key',
    description:
      'Creates an API key for the authenticated user. The token is returned **once** and only ' +
      'its hash is stored — it cannot be recovered later. Requires a user session.',
    security: bearerAuth,
    responses: {
      201: jsonRes('API key created.', {
        type: 'object',
        properties: {
          apiKey: apiKeySchema,
          token: { type: 'string', description: 'Shown only in this response.' },
        },
      }),
      403: errorRes('Requires a user session.'),
    },
  },
  list: {
    tags: ['API Keys'],
    summary: 'List own API keys',
    description: 'Lists the active API keys of the authenticated user (paginated).',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('API keys.', paginatedSchema(apiKeySchema)),
      401: errorRes('Credentials not provided or invalid.'),
    },
  },
  revoke: {
    tags: ['API Keys'],
    summary: 'Revoke an API key',
    description: 'Revokes one API key of the authenticated user. Requires a user session.',
    security: bearerAuth,
    responses: {
      200: messageRes('API key revoked.'),
      403: errorRes('Requires a user session.'),
      404: errorRes('API key not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
