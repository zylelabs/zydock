import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const volumeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    driver: { type: 'string' },
    mountpoint: { type: 'string' },
  },
};

const unreachable = errorRes('The agent of this server could not be reached.');

export const volumesDocs = {
  list: {
    tags: ['Volumes'],
    summary: 'List the volumes of a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Volumes.', { type: 'array', items: volumeSchema }),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  create: {
    tags: ['Volumes'],
    summary: 'Create a volume on a server',
    description:
      'Idempotent: an existing volume with the same name is returned as is. An application mounts ' +
      'a volume by name, so the volume has to exist before the deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Volume created.', volumeSchema),
      400: errorRes('The runtime refused the name.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Volumes'],
    summary: 'Remove a volume from a server',
    description: 'The data in the volume is lost — the runtime does not keep a copy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Volume removed.'),
      400: errorRes('The volume is still in use by a container.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
