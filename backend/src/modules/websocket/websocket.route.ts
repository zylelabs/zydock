import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { logWarn } from '../../utils/logger';
import { websocketDocs } from './websocket.docs';
import { websocketAuthMiddleware } from './websocket.middleware';
import {
  handleClientMessage,
  registerClient,
  sendToClient,
  unregisterClient,
  upgradeWebSocket,
} from './websocket.service';

const { router, get } = createRouter();

get(
  '/',
  websocketDocs.connect,
  websocketAuthMiddleware,
  upgradeWebSocket((c: Context) => {
    const auth = c.get('auth');

    let clientId = '';

    return {
      onOpen: (_event, ws) => {
        clientId = registerClient(ws, auth);

        sendToClient(clientId, 'connected', { clientId });
      },
      onMessage: event => {
        void handleClientMessage(clientId, event.data);
      },
      onClose: () => {
        unregisterClient(clientId);
      },
      onError: () => {
        logWarn('WebSocket connection error', { clientId });
        unregisterClient(clientId);
      },
    };
  }),
  (c: Context) => c.json({ error: 'Upgrade to WebSocket required' }, 426),
);

export default router;
