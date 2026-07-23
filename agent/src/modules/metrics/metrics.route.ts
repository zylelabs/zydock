import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { metricsDocs } from './metrics.docs';
import { collectContainerMetrics, collectSystemMetrics } from './metrics.service';

const { router, get } = createRouter();

get('/', metricsDocs.system, agentAuthMiddleware, async (c: Context) =>
  c.json(await collectSystemMetrics()),
);

get('/containers', metricsDocs.containers, agentAuthMiddleware, async (c: Context) =>
  c.json(await collectContainerMetrics()),
);

export default router;
