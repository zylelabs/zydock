import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { logDebug, logWarn } from '../../utils/logger';
import { upgradeWebSocket } from '../../utils/ws';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { consoleDocs } from './console.docs';

const { router, get } = createRouter();

const ALLOWED_SHELLS = ['sh', 'bash'] as const;

const shellOf = (value: string | undefined) =>
  ALLOWED_SHELLS.includes(value as never) ? (value as string) : 'sh';

/**
 * Interactive exec over WebSocket: the client's keystrokes go to the process stdin, and its output
 * comes back as text frames. It is `docker exec -i` without a TTY — Bun cannot allocate a PTY — so
 * a shell reading commands works, but full-screen programs (top, vi) will not render.
 */
get(
  '/:id/console',
  consoleDocs.connect,
  agentAuthMiddleware,
  upgradeWebSocket((c: Context) => {
    const id = c.req.param('id') ?? '';
    const shell = shellOf(c.req.query('shell'));

    let proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;

    return {
      onOpen: (_event, ws) => {
        proc = Bun.spawn(['docker', 'exec', '-i', id, shell], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });

        logDebug('Console session opened', { container: id, shell });

        const decoder = new TextDecoder();

        const pump = async (stream: ReadableStream<Uint8Array>) => {
          for await (const chunk of stream) {
            ws.send(decoder.decode(chunk, { stream: true }));
          }
        };

        void pump(proc.stdout);
        void pump(proc.stderr);

        // Docker exits with the shell; there is nothing left to stream, so the socket closes.
        void proc.exited.then(code => {
          logDebug('Console session ended', { container: id, code });
          ws.close();
        });
      },
      onMessage: event => {
        if (!proc) {
          return;
        }

        const data = event.data;
        const chunk = typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer);

        proc.stdin.write(chunk);
        proc.stdin.flush();
      },
      onClose: () => {
        proc?.stdin.end();
        proc?.kill();
      },
      onError: () => {
        logWarn('Console session error', { container: id });
        proc?.kill();
      },
    };
  }),
  (c: Context) => c.json({ error: 'Upgrade to WebSocket required' }, 426),
);

export default router;
