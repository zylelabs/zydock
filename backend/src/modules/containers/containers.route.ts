import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { logWarn } from '../../utils/logger';
import { authMiddleware } from '../auth/auth.middleware';
import { APPLICATION_LABEL } from '../deployments/pipeline.service';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { serverRuntimeMiddleware } from './container.middleware';
import { containersDocs } from './containers.docs';
import {
  ContainerIdParam,
  containerIdParamSchema,
  CreateContainerDTO,
  createContainerSchema,
  ListContainersQuery,
  listContainersQuerySchema,
  LogQueryDTO,
  logQuerySchema,
  RemoveContainerQuery,
  removeContainerQuerySchema,
  StopContainerQuery,
  stopContainerQuerySchema,
} from './containers.schema';

const { router, get, post, delete: del } = createRouter();

const LOG_KEEPALIVE_MS = 5000;

/** Each `label` query parameter carries one `key=value` pair. */
const parseLabels = (values: string[]) =>
  Object.fromEntries(
    values.flatMap(value => {
      const separator = value.indexOf('=');

      return separator > 0 ? [[value.slice(0, separator), value.slice(separator + 1)]] : [];
    }),
  );

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get(
  '/',
  containersDocs.list,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listContainersQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { state, namePrefix, applicationId } = c.req.valid(
      'query' as never,
    ) as ListContainersQuery;

    try {
      return c.json(
        await c.get('runtime').listContainers({
          state,
          namePrefix,
          labels: {
            ...parseLabels(c.req.queries('label') ?? []),
            ...(applicationId ? { [APPLICATION_LABEL]: applicationId } : {}),
          },
        }),
      );
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/',
  containersDocs.create,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createContainerSchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const body = c.req.valid('json' as never) as CreateContainerDTO;

    try {
      return c.json(await c.get('runtime').createContainer(body), 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/:containerId',
  containersDocs.get,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('member'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      const container = await c.get('runtime').inspectContainer(containerId);

      if (!container) {
        return c.json({ error: 'Container not found' }, 404);
      }

      return c.json(container);
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/:containerId/start',
  containersDocs.start,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('admin'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await c.get('runtime').startContainer(containerId);

      return c.json({ message: 'Container started' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/:containerId/stop',
  containersDocs.stop,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('query', stopContainerQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { timeout } = c.req.valid('query' as never) as StopContainerQuery;

    try {
      await c.get('runtime').stopContainer(containerId, timeout);

      return c.json({ message: 'Container stopped' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/:containerId/restart',
  containersDocs.restart,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('admin'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;

    try {
      await c.get('runtime').restartContainer(containerId);

      return c.json({ message: 'Container restarted' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/:containerId/logs',
  containersDocs.logs,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', logQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { tail, since, until, follow } = c.req.valid('query' as never) as LogQueryDTO;
    const runtime = c.get('runtime');

    try {
      if (!(await runtime.inspectContainer(containerId))) {
        return c.json({ error: 'Container not found' }, 404);
      }

      if (!follow) {
        return c.json(await runtime.getLogs(containerId, { tail, since, until }));
      }
    } catch (error) {
      return failed(c, error);
    }

    // Following relays the agent stream as it arrives; aborting closes the connection to the agent
    // as well, so a client that goes away does not leave the server streaming into nothing.
    const controller = new AbortController();

    return streamSSE(c, async stream => {
      stream.onAbort(() => controller.abort());

      // Writes are chained so that a `ping` never lands in the middle of a log line, and the ping
      // itself exists because the server closes a connection left idle — a container can stay quiet
      // far longer than that without the stream being dead.
      let queue = Promise.resolve();

      const write = (event: string, data: unknown) => {
        queue = queue.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }));

        return queue;
      };

      const keepalive = setInterval(() => {
        void write('ping', {});
      }, LOG_KEEPALIVE_MS);

      try {
        for await (const entry of runtime.streamLogs(containerId, {
          tail,
          since,
          until,
          signal: controller.signal,
        })) {
          await write('log', entry);
        }
      } catch (error) {
        logWarn('Log stream ended', { container: containerId, error: errorMessage(error) });
      } finally {
        clearInterval(keepalive);
      }
    });
  },
);

del(
  '/:containerId',
  containersDocs.remove,
  authMiddleware,
  validator('param', containerIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('query', removeContainerQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { volumes } = c.req.valid('query' as never) as RemoveContainerQuery;

    try {
      await c.get('runtime').removeContainer(containerId, volumes);

      return c.json({ message: 'Container removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
