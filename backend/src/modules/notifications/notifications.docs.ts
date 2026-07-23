import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';
import { NOTIFICATION_EVENTS, NOTIFICATION_STATUSES } from './notification.schema';

const channelSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    name: { type: 'string' },
    channel: { type: 'string', enum: ['email', 'webhook'] },
    address: { type: 'string' },
    hasSecret: { type: 'boolean' },
    events: { type: 'array', items: { type: 'string', enum: [...NOTIFICATION_EVENTS] } },
    enabled: { type: 'boolean' },
    lastDeliveryAt: { type: 'string', format: 'date-time', nullable: true },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    channelId: { type: 'string' },
    event: { type: 'string', enum: [...NOTIFICATION_EVENTS] },
    subject: { type: 'string' },
    body: { type: 'string' },
    severity: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
    metadata: { type: 'object', additionalProperties: { type: 'string' } },
    status: { type: 'string', enum: [...NOTIFICATION_STATUSES] },
    sentAt: { type: 'string', format: 'date-time', nullable: true },
    error: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const channelBody = { type: 'object', properties: { channel: channelSchema } };

const eventList = NOTIFICATION_EVENTS.join('`, `');

export const notificationsDocs = {
  listChannels: {
    tags: ['Notifications'],
    summary: 'List the notification channels of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      {
        name: 'channel',
        in: 'query' as const,
        schema: { type: 'string', enum: ['email', 'webhook'] },
      },
      { name: 'enabled', in: 'query' as const, schema: { type: 'boolean' } },
    ],
    responses: {
      200: jsonRes('Channels.', paginatedSchema(channelSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  createChannel: {
    tags: ['Notifications'],
    summary: 'Create a notification channel',
    description:
      'A channel is where an event is delivered: an e-mail address (`email`, delivered over the ' +
      'configured SMTP server) or an HTTP endpoint (`webhook`). A webhook may carry a `secret`, ' +
      'used to sign the body as `X-Zydock-Signature: sha256=<hmac>`; the secret is stored ' +
      `encrypted and never returned. Events available: \`${eventList}\`.`,
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Channel created.', channelBody),
      400: errorRes('Invalid body — the address does not fit the channel.'),
    },
  },
  getChannel: {
    tags: ['Notifications'],
    summary: 'Read a notification channel',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Channel.', channelBody),
      404: errorRes('Channel not found.'),
    },
  },
  updateChannel: {
    tags: ['Notifications'],
    summary: 'Update a notification channel',
    description:
      'The channel kind is immutable — create another one to change it. A `null` secret clears the ' +
      'signature.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Channel updated.', channelBody),
      400: errorRes('Invalid body — the address does not fit the channel.'),
      404: errorRes('Channel not found.'),
    },
  },
  removeChannel: {
    tags: ['Notifications'],
    summary: 'Remove a notification channel',
    description: 'Removes the channel and its delivery history.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Channel removed.'),
      404: errorRes('Channel not found.'),
    },
  },
  testChannel: {
    tags: ['Notifications'],
    summary: 'Send a test message through a channel',
    description:
      'Delivers immediately, without the queue, so the answer carries the real result. Nothing is ' +
      'recorded in the history; only the channel status is updated.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Delivery result.', {
        type: 'object',
        properties: { delivered: { type: 'boolean' }, error: { type: 'string', nullable: true } },
      }),
      404: errorRes('Channel not found.'),
    },
  },
  listNotifications: {
    tags: ['Notifications'],
    summary: 'Delivery history of an organization',
    description:
      'Most recent first. Retention is bounded by a TTL, so old records expire on their own. A ' +
      'record stays `pending` while the queue still has attempts left, and turns `failed` only ' +
      'when they run out.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'channelId', in: 'query' as const, schema: { type: 'string' } },
      {
        name: 'event',
        in: 'query' as const,
        schema: { type: 'string', enum: [...NOTIFICATION_EVENTS] },
      },
      {
        name: 'status',
        in: 'query' as const,
        schema: { type: 'string', enum: [...NOTIFICATION_STATUSES] },
      },
    ],
    responses: {
      200: jsonRes('Notifications.', paginatedSchema(notificationSchema)),
      404: errorRes('Organization not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
