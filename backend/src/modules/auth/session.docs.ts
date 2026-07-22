import type { DocOptions } from 'hono-route-docs';
import {
  bearerAuth,
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const sessionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userAgent: { type: 'string', nullable: true },
    ip: { type: 'string', nullable: true },
    current: { type: 'boolean' },
    expiresAt: { type: 'string', format: 'date-time' },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const sessionDocs = {
  list: {
    tags: ['Sessions'],
    summary: 'List own sessions',
    description: 'Lists the active sessions of the authenticated user (paginated).',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Sessions.', paginatedSchema(sessionSchema)),
      401: errorRes('Credentials not provided or invalid.'),
    },
  },
  revokeAll: {
    tags: ['Sessions'],
    summary: 'Revoke other sessions',
    description: 'Revokes every session of the authenticated user except the current one.',
    security: bearerAuth,
    responses: {
      200: messageRes('Sessions revoked.'),
      403: errorRes('Requires a user session.'),
    },
  },
  revoke: {
    tags: ['Sessions'],
    summary: 'Revoke a session',
    description: 'Revokes one session of the authenticated user.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Session revoked.'),
      404: errorRes('Session not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
