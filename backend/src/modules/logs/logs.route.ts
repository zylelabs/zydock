import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { ApplicationIdParam, applicationIdParamSchema } from '../applications/application.schema';
import { findApplication } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { logsToText } from './log.filter';
import { fetchApplicationLogs } from './log.service';
import { logsDocs } from './logs.docs';
import { LogsQuery, logsQuerySchema } from './logs.schema';

const { router, get } = createRouter();

get(
  '/',
  logsDocs.list,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', logsQuerySchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    if (!(await findApplication(organizationId, applicationId))) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const query = c.req.valid('query' as never) as LogsQuery;

    try {
      return c.json(await fetchApplicationLogs(applicationId, query));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

get(
  '/download',
  logsDocs.download,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', logsQuerySchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const query = c.req.valid('query' as never) as LogsQuery;

    try {
      const { entries } = await fetchApplicationLogs(applicationId, query);

      c.header('Content-Type', 'text/plain; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="${application.slug}.log"`);

      return c.body(logsToText(entries));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

export default router;
