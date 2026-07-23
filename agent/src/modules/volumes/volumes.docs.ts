import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const volumeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    driver: { type: 'string' },
    mountpoint: { type: 'string' },
  },
};

export const volumesDocs = {
  list: {
    tags: ['Volumes'],
    summary: 'List volumes',
    security: agentAuth,
    responses: {
      200: jsonRes('Volumes.', { type: 'array', items: volumeSchema }),
      401: errorRes('Invalid agent token.'),
    },
  },
  create: {
    tags: ['Volumes'],
    summary: 'Create a volume',
    description: 'Idempotent: an existing volume with the same name is returned as is.',
    security: agentAuth,
    responses: {
      201: jsonRes('Volume created.', volumeSchema),
      400: errorRes('Operation failed.'),
    },
  },
  remove: {
    tags: ['Volumes'],
    summary: 'Remove a volume',
    security: agentAuth,
    responses: {
      200: messageRes('Volume removed.'),
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
