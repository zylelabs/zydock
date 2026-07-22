import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const imageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tag: { type: 'string' },
    sizeBytes: { type: 'integer' },
    createdAt: { type: 'string' },
  },
};

export const imagesDocs = {
  pull: {
    tags: ['Images'],
    summary: 'Pull an image',
    security: agentAuth,
    responses: {
      200: jsonRes('Image pulled.', imageSchema),
      400: errorRes('The runtime refused the reference.'),
    },
  },
  build: {
    tags: ['Images'],
    summary: 'Build an image',
    description:
      'Always answers with a `text/event-stream`: `log` events carry the build output, and the ' +
      'stream ends with a single `result` event (the image) or an `error` event (the failure). ' +
      'The build context is a path on this server.',
    security: agentAuth,
    responses: {
      200: {
        description: 'Build output followed by the result.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
    },
  },
  remove: {
    tags: ['Images'],
    summary: 'Remove an image',
    security: agentAuth,
    parameters: [{ name: 'reference', in: 'query', required: true, schema: { type: 'string' } }],
    responses: {
      200: messageRes('Image removed.'),
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
