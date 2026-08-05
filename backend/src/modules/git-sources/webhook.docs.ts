import type { DocOptions } from 'hono-route-docs';
import { errorRes, jsonRes, messageRes } from '../../utils/openapi';

export const gitSourceWebhookDocs = {
  receive: {
    tags: ['Webhooks'],
    summary: 'Receive a push event from the GitHub App',
    description:
      'Public endpoint, one URL per git source, authenticated by the HMAC signature of the ' +
      'body. A push may fan out to every application pointing at that repository and branch.',
    responses: {
      202: jsonRes('Deployment(s) queued.', {
        type: 'object',
        properties: { message: { type: 'string' }, queued: { type: 'integer' } },
      }),
      200: messageRes('Delivery accepted, no deployment queued.'),
      401: errorRes('Invalid signature.'),
      404: errorRes('Git source not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
