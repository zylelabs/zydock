import type { DocOptions } from 'hono-route-docs';
import { errorRes, jsonRes, messageRes } from '../../utils/openapi';

export const webhookDocs = {
  receive: {
    tags: ['Webhooks'],
    summary: 'Receive a push event from the git host',
    description:
      'Public endpoint, authenticated by the HMAC signature of the body. A push to another ' +
      'branch, or to an application with auto deploy disabled, answers `200` without queuing ' +
      'anything — it is a valid delivery that simply does not deploy.',
    responses: {
      202: jsonRes('Deployment queued.', {
        type: 'object',
        properties: { message: { type: 'string' }, deployment: { type: 'string' } },
      }),
      200: messageRes('Delivery accepted, no deployment queued.'),
      401: errorRes('Invalid signature.'),
      404: errorRes('Application not found.'),
    },
  },
  configure: {
    tags: ['Webhooks'],
    summary: 'Create the push webhook on the git host',
    description: 'Replaces the previous webhook, if any, and stores a new secret.',
    responses: {
      201: jsonRes('Webhook configured.', {
        type: 'object',
        properties: {
          webhook: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              events: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      }),
      400: errorRes('The git host refused the webhook.'),
      404: errorRes('Application not found.'),
    },
  },
  remove: {
    tags: ['Webhooks'],
    summary: 'Remove the push webhook from the git host',
    responses: {
      200: messageRes('Webhook removed successfully.'),
      404: errorRes('Application or webhook not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
