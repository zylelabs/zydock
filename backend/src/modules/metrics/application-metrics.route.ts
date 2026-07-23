import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { ApplicationIdParam, applicationIdParamSchema } from '../applications/application.schema';
import { findApplication } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerById } from '../servers/server.service';
import { deploymentMetrics, fetchApplicationMetrics } from './metric.service';
import { metricsDocs } from './metrics.docs';

const { router, get } = createRouter();

get(
  '/',
  metricsDocs.application,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const server = await findServerById(String(application.serverId));

    if (!server?.agent.token) {
      return c.json({ error: 'This server has no agent yet' }, 409);
    }

    try {
      return c.json(await fetchApplicationMetrics(application, server));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

get(
  '/deployments',
  metricsDocs.deployments,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    if (!(await findApplication(organizationId, applicationId))) {
      return c.json({ error: 'Application not found' }, 404);
    }

    return c.json(await deploymentMetrics(applicationId));
  },
);

export default router;
