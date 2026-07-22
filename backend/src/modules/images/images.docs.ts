import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const imageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tag: { type: 'string' },
    sizeBytes: { type: 'integer' },
    createdAt: { type: 'string' },
  },
};

const unreachable = errorRes('The agent of this server could not be reached.');

export const imagesDocs = {
  list: {
    tags: ['Images'],
    summary: 'List the images of a server',
    description:
      'Images built by the platform are tagged `zydock/<slug>:<commit>`. Images that lost their ' +
      'tag are listed as `<none>` — they still occupy the disk.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Images.', { type: 'array', items: imageSchema }),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  pull: {
    tags: ['Images'],
    summary: 'Pull an image into a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Image pulled.', imageSchema),
      400: errorRes('The runtime refused the reference.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Images'],
    summary: 'Remove an image from a server',
    description:
      'The reference is a tag or an image id. Removing a tag that a container still uses only ' +
      'untags the image — the layers stay on disk until no container refers to them, and until ' +
      'then the image is listed as `<none>`. Building an image is not exposed here: it needs a ' +
      'build context on the server, which the deploy pipeline produces.',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'reference', in: 'query', required: true, schema: { type: 'string' } }],
    responses: {
      200: messageRes('Image removed, or only untagged when a container still refers to it.'),
      400: errorRes('The runtime refused the removal.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
