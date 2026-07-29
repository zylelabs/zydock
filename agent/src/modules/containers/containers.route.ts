import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logWarn } from '../../utils/logger';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { clearManualStop, markManuallyStopped } from '../agent/monitor.service';
import { containersDocs } from './containers.docs';
import {
  ContainerIdParam,
  containerIdParamSchema,
  CreateContainerDTO,
  createContainerSchema,
  ExecDTO,
  execSchema,
} from './containers.schema';

const { router, get, post, delete: del } = createRouter();

const containers = resolveContainerProvider();

const LOG_KEEPALIVE_MS = 5000;

const LOG_STALL_TIMEOUT_MS = 15000;

const parseLabels = (values: string[]) =>
  Object.fromEntries(
    values.flatMap(value => {
      const separator = value.indexOf('=');

      return separator > 0 ? [[value.slice(0, separator), value.slice(separator + 1)]] : [];
    }),
  );

get('/', containersDocs.list, agentAuthMiddleware, async (c: Context) => {
  const state = c.req.query('state');
  const namePrefix = c.req.query('namePrefix');

  return c.json(
    await containers.listContainers({
      state: state as never,
      namePrefix,
      labels: parseLabels(c.req.queries('label') ?? []),
    }),
  );
});

post(
  '/',
  containersDocs.create,
  agentAuthMiddleware,
  validator('json', createContainerSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as CreateContainerDTO;

    try {
      return c.json(await containers.createContainer(body), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/:id',
  containersDocs.get,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    const container = await containers.inspectContainer(id);

    if (!container) {
      return c.json({ error: 'Container not found' }, 404);
    }

    return c.json(container);
  },
);

post(
  '/:id/start',
  containersDocs.start,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await containers.startContainer(id);
      clearManualStop(id);

      return c.json({ message: 'Container started' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/:id/stop',
  containersDocs.stop,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await containers.stopContainer(id, Number(c.req.query('timeout')) || undefined);
      markManuallyStopped(id);

      return c.json({ message: 'Container stopped' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/:id/restart',
  containersDocs.restart,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await containers.restartContainer(id);
      clearManualStop(id);

      return c.json({ message: 'Container restarted' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/:id/exec',
  containersDocs.exec,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  validator('json', execSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;
    const body = c.req.valid('json' as never) as ExecDTO;

    if (!(await containers.inspectContainer(id))) {
      return c.json({ error: 'Container not found' }, 404);
    }

    return c.json(await containers.execCommand(id, body));
  },
);

get(
  '/:id/logs',
  containersDocs.logs,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    if (!(await containers.inspectContainer(id))) {
      return c.json({ error: 'Container not found' }, 404);
    }

    const tail = Number(c.req.query('tail')) || undefined;
    const since = c.req.query('since');
    const until = c.req.query('until');

    if (c.req.query('follow') !== 'true') {
      return c.json(await containers.getLogs(id, { tail, since, until }));
    }

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
        for await (const entry of containers.streamLogs(id, {
          tail,
          since,
          until,
          signal: controller.signal,
        })) {
          await write('log', entry);
        }
      } catch (error) {
        logWarn('Log stream ended', { container: id, error: errorMessage(error) });
      } finally {
        stop();
      }
    });
  },
);

del(
  '/:id',
  containersDocs.remove,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await containers.removeContainer(id, c.req.query('volumes') === 'true');
      clearManualStop(id);

      return c.json({ message: 'Container removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
