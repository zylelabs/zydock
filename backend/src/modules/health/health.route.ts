import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { healthDocs } from './health.docs';
import { getHealthReport } from './health.service';

const { router, get } = createRouter();

get('/', healthDocs.check, (c: Context) => {
  const report = getHealthReport();

  if (report.status !== 'ok') {
    return c.json(report, 503);
  }

  return c.json(report);
});

export default router;
