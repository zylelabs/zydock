import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { ApplicationIdParam, applicationIdParamSchema } from '../applications/application.schema';
import { findApplication } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { listDomainsOfApplication } from '../domains/domain.service';
import { logWarn } from '../../utils/logger';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerById } from '../servers/server.service';
import { AccessStatsQueryDTO, accessStatsQuerySchema } from './access-aggregate.schema';
import { fetchApplicationAccessStats } from './access-aggregate.service';
import { proxyDocs } from './proxy.docs';
import {
  AccessQueryDTO,
  accessQuerySchema,
  AccessStreamQueryDTO,
  accessStreamQuerySchema,
} from './proxy.schema';
import {
  fetchApplicationAccess,
  resolveProxyOfServer,
  streamApplicationAccess,
} from './proxy.service';

const { router, get } = createRouter();

const LOG_KEEPALIVE_MS = 5000;

const LOG_STALL_TIMEOUT_MS = 15000;

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

const loadApplication = async (c: Context) => {
  const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
  const application = await findApplication(organizationId, applicationId);

  if (!application) {
    return { response: c.json({ error: 'Application not found' }, 404) };
  }

  const server = await findServerById(String(application.serverId));

  if (!server?.agent.token) {
    return { response: c.json({ error: 'This server has no agent yet' }, 409) };
  }

  const domains = await listDomainsOfApplication(applicationId);

  return { server, hostnames: domains.map(domain => domain.hostname) };
};

const loadApplicationHostnames = async (c: Context) => {
  const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
  const application = await findApplication(organizationId, applicationId);

  if (!application) {
    return { response: c.json({ error: 'Application not found' }, 404) };
  }

  const domains = await listDomainsOfApplication(applicationId);

  return { hostnames: domains.map(domain => domain.hostname) };
};

get(
  '/access',
  proxyDocs.applicationList,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessQuerySchema),
  async (c: Context) => {
    const loaded = await loadApplication(c);

    if (!loaded.server) {
      return loaded.response;
    }

    const query = c.req.valid('query' as never) as AccessQueryDTO;

    try {
      const proxy = resolveProxyOfServer(loaded.server);

      return c.json(await fetchApplicationAccess(proxy, loaded.hostnames, query));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/access/stream',
  proxyDocs.applicationStream,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessStreamQuerySchema),
  async (c: Context) => {
    const loaded = await loadApplication(c);

    if (!loaded.server) {
      return loaded.response;
    }

    const { applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
    const query = c.req.valid('query' as never) as AccessStreamQueryDTO;
    const proxy = resolveProxyOfServer(loaded.server);
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
        for await (const entry of streamApplicationAccess(proxy, loaded.hostnames, {
          ...query,
          signal: controller.signal,
        })) {
          await write('log', entry);
        }
      } catch (error) {
        logWarn('Proxy access stream ended', {
          application: applicationId,
          error: errorMessage(error),
        });
      } finally {
        stop();
      }
    });
  },
);

get(
  '/access/stats',
  proxyDocs.applicationStats,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessStatsQuerySchema),
  async (c: Context) => {
    const loaded = await loadApplicationHostnames(c);

    if (!loaded.hostnames) {
      return loaded.response;
    }

    const query = c.req.valid('query' as never) as AccessStatsQueryDTO;

    return c.json(await fetchApplicationAccessStats(loaded.hostnames, query.minutes));
  },
);

export default router;
