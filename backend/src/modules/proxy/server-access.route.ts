import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { logWarn } from '../../utils/logger';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { ServerIdParam, serverIdParamSchema } from '../servers/server.schema';
import { findServer, findServerWithAgentToken } from '../servers/server.service';
import { isSuperuser } from '../users/user.service';
import { AccessStatsQueryDTO, accessStatsQuerySchema } from './access-aggregate.schema';
import { fetchServerAccessStats } from './access-aggregate.service';
import { proxyDocs } from './proxy.docs';
import {
  AccessQueryDTO,
  accessQuerySchema,
  AccessStreamQueryDTO,
  accessStreamQuerySchema,
} from './proxy.schema';
import { fetchServerAccess, resolveProxyOfServer, streamServerAccess } from './proxy.service';

const { router, get } = createRouter();

const LOG_KEEPALIVE_MS = 5000;

const LOG_STALL_TIMEOUT_MS = 15000;

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

const loadServer = async (c: Context) => {
  const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;
  const server = await findServerWithAgentToken(organizationId, serverId);

  if (!server) {
    return { response: c.json({ error: 'Server not found' }, 404) };
  }

  if (!server.agent.token) {
    return { response: c.json({ error: 'This server has no agent yet' }, 409) };
  }

  return { server };
};

get(
  '/access',
  proxyDocs.serverList,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessQuerySchema),
  async (c: Context) => {
    const loaded = await loadServer(c);

    if (!loaded.server) {
      return loaded.response;
    }

    const { organizationId } = c.req.valid('param' as never) as ServerIdParam;
    const query = c.req.valid('query' as never) as AccessQueryDTO;
    const superuser = await isSuperuser(c.get('auth').email);

    try {
      const proxy = resolveProxyOfServer(loaded.server);

      return c.json(await fetchServerAccess(proxy, organizationId, superuser, query));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/access/stream',
  proxyDocs.serverStream,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessStreamQuerySchema),
  async (c: Context) => {
    const loaded = await loadServer(c);

    if (!loaded.server) {
      return loaded.response;
    }

    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;
    const query = c.req.valid('query' as never) as AccessStreamQueryDTO;
    const superuser = await isSuperuser(c.get('auth').email);
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
        for await (const entry of streamServerAccess(proxy, organizationId, superuser, {
          ...query,
          signal: controller.signal,
        })) {
          await write('log', entry);
        }
      } catch (error) {
        logWarn('Proxy access stream ended', { server: serverId, error: errorMessage(error) });
      } finally {
        stop();
      }
    });
  },
);

get(
  '/access/stats',
  proxyDocs.serverStats,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', accessStatsQuerySchema),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;
    const query = c.req.valid('query' as never) as AccessStatsQueryDTO;
    const server = await findServer(organizationId, serverId);

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    const superuser = await isSuperuser(c.get('auth').email);

    return c.json(await fetchServerAccessStats(serverId, organizationId, superuser, query.minutes));
  },
);

export default router;
