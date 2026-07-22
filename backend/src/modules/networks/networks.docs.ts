import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const networkSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    driver: { type: 'string' },
  },
};

const unreachable = errorRes('The agent of this server could not be reached.');

export const networksDocs = {
  list: {
    tags: ['Networks'],
    summary: 'List the networks of a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Networks.', { type: 'array', items: networkSchema }),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  create: {
    tags: ['Networks'],
    summary: 'Create a network on a server',
    description:
      'Idempotent: an existing network with the same name is returned as is. An application joins ' +
      'a network by name, so the network has to exist before the deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Network created.', networkSchema),
      400: errorRes('The runtime refused the name.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Networks'],
    summary: 'Remove a network from a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Network removed.'),
      400: errorRes('The network is still in use by a container.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
