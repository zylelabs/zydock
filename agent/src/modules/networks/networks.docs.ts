import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const networkSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    driver: { type: 'string' },
  },
};

export const networksDocs = {
  list: {
    tags: ['Networks'],
    summary: 'List networks',
    security: agentAuth,
    responses: {
      200: jsonRes('Networks.', { type: 'array', items: networkSchema }),
      401: errorRes('Invalid agent token.'),
    },
  },
  create: {
    tags: ['Networks'],
    summary: 'Create a network',
    description: 'Idempotent: an existing network with the same name is returned as is.',
    security: agentAuth,
    responses: {
      201: jsonRes('Network created.', networkSchema),
      400: errorRes('Operation failed.'),
    },
  },
  remove: {
    tags: ['Networks'],
    summary: 'Remove a network',
    security: agentAuth,
    responses: {
      200: messageRes('Network removed.'),
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
