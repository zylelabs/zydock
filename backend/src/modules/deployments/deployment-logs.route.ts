import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { logsToText } from '../logs/log.filter';
import { LogsQuery, logsQuerySchema } from '../logs/logs.schema';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { DeploymentIdParam, deploymentIdParamSchema } from './deployment.schema';
import { buildLogEntries, findDeployment } from './deployment.service';
import { deploymentsDocs } from './deployments.docs';

const { router, get } = createRouter();

get(
  '/',
  deploymentsDocs.logs,
  authMiddleware,
  validator('param', deploymentIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', logsQuerySchema),
  async (c: Context) => {
    const { organizationId, deploymentId } = c.req.valid('param' as never) as DeploymentIdParam;

    const deployment = await findDeployment(organizationId, deploymentId);

    if (!deployment) {
      return c.json({ error: 'Deployment not found' }, 404);
    }

    const query = c.req.valid('query' as never) as LogsQuery;

    return c.json({ deploymentId, entries: buildLogEntries(deployment, query) });
  },
);

get(
  '/download',
  deploymentsDocs.logsDownload,
  authMiddleware,
  validator('param', deploymentIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', logsQuerySchema),
  async (c: Context) => {
    const { organizationId, deploymentId } = c.req.valid('param' as never) as DeploymentIdParam;

    const deployment = await findDeployment(organizationId, deploymentId);

    if (!deployment) {
      return c.json({ error: 'Deployment not found' }, 404);
    }

    const query = c.req.valid('query' as never) as LogsQuery;

    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="deploy-${deploymentId}.log"`);

    return c.body(logsToText(buildLogEntries(deployment, query)));
  },
);

export default router;
