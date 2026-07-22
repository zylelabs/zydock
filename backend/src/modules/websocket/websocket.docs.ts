import type { DocOptions } from 'hono-route-docs';
import { errorRes } from '../../utils/openapi';

export const websocketDocs = {
  connect: {
    tags: ['WebSocket'],
    summary: 'Open the WebSocket channel',
    description:
      'Upgrades the connection to WebSocket. The client sends JSON messages ' +
      '({ "action": "subscribe" | "unsubscribe", "topic": "..." } or { "action": "ping" }) ' +
      'and receives events as { "event": "...", "data": { ... } }. ' +
      'Published events also carry the originating topic.',
    responses: {
      101: { description: 'Protocol switched to WebSocket.' },
      426: errorRes('Upgrade to WebSocket required.'),
    },
  },
} satisfies Record<string, DocOptions>;
