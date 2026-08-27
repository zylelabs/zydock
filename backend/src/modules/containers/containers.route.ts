import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { logWarn } from '../../utils/logger';
import { findApplicationWithSecrets } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { maskSecrets, secretValuesOf } from '../compose/compose.service';
import { APPLICATION_LABEL } from '../deployments/naming';
import { blockOnStandby } from '../installation/installation.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { serverRuntimeMiddleware } from './container.middleware';
import { containersDocs } from './containers.docs';
import {
  isResourceProtected,
  PROTECTED_RESOURCE_MESSAGE,
  PROTECTED_RESOURCE_STATUS,
} from './protection.service';
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

const LOG_STALL_TIMEOUT_MS = 15000;

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
  blockOnStandby,
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
  blockOnStandby,
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
  blockOnStandby,
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
  blockOnStandby,
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

    let secretValues: string[] = [];

    try {
      const container = await runtime.inspectContainer(containerId);

      if (!container) {
        return c.json({ error: 'Container not found' }, 404);
      }

      const applicationId = container.labels[APPLICATION_LABEL];
      const organizationId = c.req.param('organizationId');

      if (applicationId && organizationId) {
        const application = await findApplicationWithSecrets(organizationId, applicationId);

        secretValues = application ? secretValuesOf(application) : [];
      }

      if (!follow) {
        const logs = await runtime.getLogs(containerId, { tail, since, until });

        return c.json(
          logs.map(entry => ({ ...entry, message: maskSecrets(entry.message, secretValues) })),
        );
      }
    } catch (error) {
      return failed(c, error);
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
        for await (const entry of runtime.streamLogs(containerId, {
          tail,
          since,
          until,
          signal: controller.signal,
        })) {
          await write('log', { ...entry, message: maskSecrets(entry.message, secretValues) });
        }
      } catch (error) {
        logWarn('Log stream ended', { container: containerId, error: errorMessage(error) });
      } finally {
        stop();
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
  blockOnStandby,
  validator('query', removeContainerQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { volumes } = c.req.valid('query' as never) as RemoveContainerQuery;
    const runtime = c.get('runtime');

    try {
      if (await isResourceProtected(runtime, 'container', containerId)) {
        return c.json({ error: PROTECTED_RESOURCE_MESSAGE }, PROTECTED_RESOURCE_STATUS);
      }

      await runtime.removeContainer(containerId, volumes);

      return c.json({ message: 'Container removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
