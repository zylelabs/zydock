import type { DocOptions } from 'hono-route-docs';
import { errorRes } from '../../utils/openapi';

export const websocketDocs = {
  connect: {
    tags: ['WebSocket'],
    summary: 'Open the WebSocket channel',
    description:
      'Upgrades the connection to WebSocket. Authentication uses the `token` query parameter ' +
      'with a valid access token, because browsers cannot set headers on a WebSocket handshake. ' +
      'The client sends JSON messages ' +
      '({ "action": "subscribe" | "unsubscribe", "topic": "..." } or { "action": "ping" }) ' +
      'and receives events as { "event": "...", "data": { ... } }. ' +
      'Published events also carry the originating topic.',
    parameters: [
      {
        name: 'token',
        in: 'query',
        required: true,
        description: 'Access token (the same JWT used as a Bearer token).',
        schema: { type: 'string' },
      },
    ],
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      401: errorRes('Access token not provided, invalid or expired.'),
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
