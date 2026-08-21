import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { resolveContainerProvider } from '../../providers/container';
import type { ConsoleSession } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logDebug, logWarn } from '../../utils/logger';
import { upgradeWebSocket } from '../../utils/ws';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { consoleDocs } from './console.docs';
import { consoleControlSchema, consoleModeSchema } from './console.schema';
import { isProtectedContainer, PROTECTED_RESOURCE_MESSAGE } from './protection.service';

const { router, get } = createRouter();

const containers = resolveContainerProvider();

const ALLOWED_SHELLS = ['sh', 'bash'] as const;

const shellOf = (value: string | undefined) =>
  ALLOWED_SHELLS.includes(value as never) ? (value as string) : 'sh';

export const modeOf = (value: string | undefined) => {
  const parsed = consoleModeSchema.safeParse(value);

  return parsed.success ? parsed.data : 'shell';
};

const toText = (data: ArrayBuffer | Uint8Array) =>
  new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));

get(
  '/:id/console',
  consoleDocs.connect,
  agentAuthMiddleware,
  upgradeWebSocket((c: Context) => {
    const id = c.req.param('id') ?? '';
    const shell = shellOf(c.req.query('shell'));
    const mode = modeOf(c.req.query('mode'));

    let session: ConsoleSession | undefined;
    const pending: (string | Uint8Array)[] = [];

    const handleControl = (raw: ArrayBuffer | Uint8Array) => {
      let payload: unknown;

      try {
        payload = JSON.parse(toText(raw));
      } catch {
        logWarn('Console control frame is not valid JSON', { container: id });
        return;
      }

      const control = consoleControlSchema.safeParse(payload);

      if (!control.success) {
        logWarn('Console control frame rejected', { container: id });
        return;
      }

      void session?.resize(control.data.columns, control.data.rows).catch(error => {
        logWarn('Console resize failed', { container: id, error: errorMessage(error) });
      });
    };

    return {
      onOpen: (_event, ws) => {
        void (async () => {
          try {
            const container = await containers.inspectContainer(id);

            if (!container) {
              ws.send('Failed to open the console: container not found\r\n');
              ws.close();
              return;
            }

            if (isProtectedContainer(container)) {
              logWarn('Console session denied for a protected container', { container: id });
              ws.send(`Failed to open the console: ${PROTECTED_RESOURCE_MESSAGE}\r\n`);
              ws.close();
              return;
            }

            session = await containers.openConsole(id, {
              shell,
              mode,
              onData: chunk => ws.send(chunk),
              onClose: () => ws.close(),
            });

            for (const frame of pending) {
              session.write(frame);
            }

            pending.length = 0;

            logDebug('Console session opened', { container: id, shell, mode });
          } catch (error) {
            logWarn('Console session failed to open', {
              container: id,
              error: errorMessage(error),
            });

            ws.send(`Failed to open the console: ${errorMessage(error)}\r\n`);
            ws.close();
          }
        })();
      },
      onMessage: event => {
        const data = event.data;

        if (typeof data !== 'string') {
          handleControl(data as ArrayBuffer | Uint8Array);
          return;
        }

        if (!session) {
          pending.push(data);
          return;
        }

        session.write(data);
      },
      onClose: () => {
        session?.close();
        session = undefined;

        logDebug('Console session closed', { container: id });
      },
      onError: () => {
        logWarn('Console session error', { container: id });

        session?.close();
        session = undefined;
      },
    };
  }),
  (c: Context) => c.json({ error: 'Upgrade to WebSocket required' }, 426),
);

export default router;
