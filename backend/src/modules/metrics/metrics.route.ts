import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerWithAgentToken } from '../servers/server.service';
import { ServerIdParam, serverIdParamSchema } from '../servers/server.schema';
import {
  fetchServerContainerMetrics,
  fetchServerMetrics,
  serverMetricsHistory,
} from './metric.service';
import { metricsDocs } from './metrics.docs';
import { HistoryQuery, historyQuerySchema } from './metrics.schema';

const { router, get } = createRouter();

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
  '/',
  metricsDocs.server,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const loaded = await loadServer(c);

    if (!loaded.server) {
      return loaded.response;
    }

    try {
      return c.json(await fetchServerMetrics(loaded.server));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/containers',
  metricsDocs.serverContainers,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const loaded = await loadServer(c);

    if (!loaded.server) {
      return loaded.response;
    }

    try {
      return c.json(await fetchServerContainerMetrics(loaded.server));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/history',
  metricsDocs.history,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', historyQuerySchema),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;

    if (!(await findServerWithAgentToken(organizationId, serverId))) {
      return c.json({ error: 'Server not found' }, 404);
    }

    const { since, limit } = c.req.valid('query' as never) as HistoryQuery;

    return c.json({ items: await serverMetricsHistory(serverId, { since, limit }) });
  },
);

export default router;
