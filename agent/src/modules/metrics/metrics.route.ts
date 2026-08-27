import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { metricsDocs } from './metrics.docs';
import { collectContainerMetrics, collectSystemMetrics } from './metrics.service';

const { router, get } = createRouter();

const parseLabels = (values: string[]) =>
  Object.fromEntries(
    values.flatMap(value => {
      const separator = value.indexOf('=');

      return separator > 0 ? [[value.slice(0, separator), value.slice(separator + 1)]] : [];
    }),
  );

get('/', metricsDocs.system, agentAuthMiddleware, async (c: Context) =>
  c.json(await collectSystemMetrics()),
);

get('/containers', metricsDocs.containers, agentAuthMiddleware, async (c: Context) => {
  const ids = c.req.queries('id') ?? [];
  const labels = parseLabels(c.req.queries('label') ?? []);

  return c.json(
    await collectContainerMetrics({
      ids: ids.length ? ids : undefined,
      labels: Object.keys(labels).length ? labels : undefined,
    }),
  );
});

export default router;
