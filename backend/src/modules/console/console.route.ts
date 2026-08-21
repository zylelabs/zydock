import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { logDebug, logWarn } from '../../utils/logger';
import { endAuditLog, startAuditLog } from '../audit/audit-log.service';
import { findActiveSessionById } from '../auth/session.service';
import { ContainerIdParam, containerIdParamSchema } from '../containers/containers.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { buildAgentConnection, findServerWithAgentToken } from '../servers/server.service';
import { upgradeWebSocket } from '../websocket/websocket.service';
import { websocketAuthMiddleware } from '../websocket/websocket.middleware';
import { consoleDocs } from './console.docs';
import { ConsoleSessionHandle, registerConsoleSession, unregisterConsoleSession } from './console.service';

const { router, get } = createRouter();

const ALLOWED_SHELLS = ['sh', 'bash'];

const ALLOWED_MODES = ['shell', 'attach'];

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
    const requestedMode = c.req.query('mode');
    const mode = ALLOWED_MODES.includes(requestedMode ?? '') ? requestedMode : 'shell';
    const auth = c.get('auth');

    let agent: WebSocket | undefined;
    let closed = false;
    let auditLogId: string | undefined;
    let sessionHandle: ConsoleSessionHandle | undefined;
    const pending: (string | ArrayBuffer)[] = [];

    return {
      onOpen: (_event, ws) => {
        void (async () => {
          if (auth.sid && !(await findActiveSessionById(auth.sid))) {
            ws.send('This session has been revoked.\r\n');
            ws.close();
            return;
          }

          const server = await findServerWithAgentToken(organizationId, serverId);

          if (!server?.agent.token) {
            ws.send('This server has no agent yet: provision it first.\r\n');
            ws.close();
            return;
          }

          const auditLog = await startAuditLog({
            organizationId,
            userId: auth.sub,
            serverId,
            action: 'console',
            containerId,
          });

          auditLogId = String(auditLog._id);

          if (auth.sid) {
            sessionHandle = { close: () => ws.close() };
            registerConsoleSession(auth.sid, sessionHandle);
          }

          const connection = buildAgentConnection(server);
          const endpoint = connection.endpoint.replace(/^http/, 'ws');
          const url = `${endpoint}/api/containers/${encodeURIComponent(containerId)}/console?shell=${shell}&mode=${mode}`;

          agent = new WebSocket(url, {
            headers: { 'X-Agent-Token': connection.token },
            ...(connection.tls ? { tls: connection.tls } : {}),
          });

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

        if (agent?.readyState === WebSocket.OPEN) {
          agent.send(frame);
        } else {
          pending.push(frame);
        }
      },
      onClose: () => {
        closed = true;
        agent?.close();

        if (auth.sid && sessionHandle) {
          unregisterConsoleSession(auth.sid, sessionHandle);
        }

        if (auditLogId) {
          void endAuditLog(auditLogId);
        }

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
