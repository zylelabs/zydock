import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { logDebug, logWarn } from '../../utils/logger';
import { ContainerIdParam, containerIdParamSchema } from '../containers/containers.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { buildAgentConnection, findServerWithAgentToken } from '../servers/server.service';
import { upgradeWebSocket } from '../websocket/websocket.service';
import { websocketAuthMiddleware } from '../websocket/websocket.middleware';
import { consoleDocs } from './console.docs';

const { router, get } = createRouter();

const ALLOWED_SHELLS = ['sh', 'bash'];

/**
 * Bridges a browser WebSocket to the agent's interactive console. The backend never runs Docker: it
 * opens a second WebSocket to the agent (authenticated by the agent token in a header, which a
 * browser could not send) and relays frames both ways. When one side closes, so does the other.
 */
get(
  '/',
  consoleDocs.connect,
  websocketAuthMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('admin'),
  upgradeWebSocket((c: Context) => {
    const { organizationId, serverId, containerId } = c.req.valid(
      'param' as never,
    ) as ContainerIdParam;
    const requestedShell = c.req.query('shell');
    const shell = ALLOWED_SHELLS.includes(requestedShell ?? '') ? requestedShell : 'sh';

    let agent: WebSocket | undefined;
    let closed = false;
    const pending: (string | ArrayBuffer)[] = [];

    return {
      onOpen: (_event, ws) => {
        void (async () => {
          const server = await findServerWithAgentToken(organizationId, serverId);

          if (!server?.agent.token) {
            ws.send('This server has no agent yet: provision it first.\r\n');
            ws.close();
            return;
          }

          const connection = buildAgentConnection(server);
          const endpoint = connection.endpoint.replace(/^http/, 'ws');
          const url = `${endpoint}/api/containers/${encodeURIComponent(containerId)}/console?shell=${shell}`;

          agent = new WebSocket(url, { headers: { 'X-Agent-Token': connection.token } });

          agent.addEventListener('open', () => {
            for (const frame of pending) {
              agent?.send(frame);
            }

            pending.length = 0;

            logDebug('Console bridge opened', { server: serverId, container: containerId });
          });

          agent.addEventListener('message', event => ws.send(event.data as string | ArrayBuffer));
          agent.addEventListener('close', () => ws.close());
          agent.addEventListener('error', () => {
            if (!closed) {
              ws.send('The console connection to the server failed.\r\n');
              ws.close();
            }
          });
        })();
      },
      onMessage: event => {
        const frame = event.data as string | ArrayBuffer;

        // Keystrokes typed before the agent socket is open are held, not dropped.
        if (agent?.readyState === WebSocket.OPEN) {
          agent.send(frame);
        } else {
          pending.push(frame);
        }
      },
      onClose: () => {
        closed = true;
        agent?.close();

        logWarn('Console bridge closed', { server: serverId, container: containerId });
      },
      onError: () => {
        closed = true;
        agent?.close();
      },
    };
  }),
  (c: Context) => c.json({ error: 'Upgrade to WebSocket required' }, 426),
);

export default router;
