import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { logWarn } from '../../utils/logger';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { proxyAccessDocs } from './proxy.access.docs';
import { AccessQueryDTO, accessQuerySchema } from './proxy.access.schema';
import { listAccess, streamAccess } from './proxy.access.service';

const { router, get } = createRouter();

const LOG_KEEPALIVE_MS = 5000;

const LOG_STALL_TIMEOUT_MS = 15000;

get(
  '/access',
  proxyAccessDocs.list,
  agentAuthMiddleware,
  validator('query', accessQuerySchema),
  async (c: Context) => {
    const query = c.req.valid('query' as never) as AccessQueryDTO;

    try {
      return c.json(await listAccess(query));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/access/stream',
  proxyAccessDocs.stream,
  agentAuthMiddleware,
  validator('query', accessQuerySchema),
  async (c: Context) => {
    const query = c.req.valid('query' as never) as AccessQueryDTO;
    const controller = new AbortController();

    return streamSSE(c, async stream => {
      let queue = Promise.resolve();
      let keepalive: ReturnType<typeof setInterval> | undefined;

      const write = (event: string, data: unknown) => {
        queue = queue.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }));

        return queue;
      };

      const stop = () => {
        clearInterval(keepalive);
        controller.abort();
      };

      stream.onAbort(stop);

      keepalive = setInterval(() => {
        const pending = write('ping', {});
        const stalled = setTimeout(stop, LOG_STALL_TIMEOUT_MS);

        void pending.finally(() => clearTimeout(stalled));
      }, LOG_KEEPALIVE_MS);

      try {
        for await (const entry of streamAccess({ ...query, signal: controller.signal })) {
          await write('log', entry);
        }
      } catch (error) {
        logWarn('Access log stream ended', { error: errorMessage(error) });
      } finally {
        stop();
      }
    });
  },
);

export default router;
