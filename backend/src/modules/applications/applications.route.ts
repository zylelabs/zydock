import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findEnvironmentOfOrganization } from '../projects/environment.service';
import { findServer } from '../servers/server.service';
import applicationModel from './application.model';
import {
  ApplicationIdParam,
  applicationIdParamSchema,
  CreateApplicationDTO,
  createApplicationSchema,
  listApplicationsQuerySchema,
  ReplaceVariablesDTO,
  replaceVariablesSchema,
  UpdateApplicationDTO,
  updateApplicationSchema,
} from './application.schema';
import {
  createApplication,
  decryptVariables,
  findApplication,
  findApplicationWithSecrets,
  replaceVariables,
  serializeApplication,
  updateApplication,
} from './application.service';
import { applicationsDocs } from './applications.docs';

const { router, get, post, patch, put, delete: del } = createRouter();

get(
  '/',
  applicationsDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listApplicationsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { projectId, environmentId, serverId } = c.req.valid('query' as never) as Record<
      string,
      string | undefined
    >;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await applicationModel.paginate(
      {
        organizationId,
        ...(projectId ? { projectId } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(serverId ? { serverId } : {}),
      },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeApplication) });
  },
);

post(
  '/',
  applicationsDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createApplicationSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateApplicationDTO;

    const environment = await findEnvironmentOfOrganization(organizationId, body.environmentId);

    if (!environment) {
      return c.json({ error: 'Environment not found in this organization' }, 400);
    }

    if (!(await findServer(organizationId, body.serverId))) {
      return c.json({ error: 'Server not found in this organization' }, 400);
    }

    const application = await createApplication(
      organizationId,
      String(environment.projectId),
      body,
    );

    return c.json({ application: serializeApplication(application) }, 201);
  },
);

get(
  '/:applicationId',
  applicationsDocs.get,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    return c.json({ application: serializeApplication(application) });
  },
);

patch(
  '/:applicationId',
  applicationsDocs.update,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateApplicationSchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
    const body = c.req.valid('json' as never) as UpdateApplicationDTO;

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    if (body.serverId && !(await findServer(organizationId, body.serverId))) {
      return c.json({ error: 'Server not found in this organization' }, 400);
    }

    const updated = await updateApplication(application, body);

    return c.json({ application: serializeApplication(updated!) });
  },
);

get(
  '/:applicationId/variables',
  applicationsDocs.listVariables,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplicationWithSecrets(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    return c.json({ variables: decryptVariables(application.variables) });
  },
);

put(
  '/:applicationId/variables',
  applicationsDocs.replaceVariables,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', replaceVariablesSchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
    const body = c.req.valid('json' as never) as ReplaceVariablesDTO;

    if (!(await findApplication(organizationId, applicationId))) {
      return c.json({ error: 'Application not found' }, 404);
    }

    await replaceVariables(applicationId, body.variables);

    return c.json({ variables: body.variables });
  },
);

del(
  '/:applicationId',
  applicationsDocs.remove,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const result = await applicationModel.deleteOne({ _id: applicationId, organizationId });

    if (!result.deletedCount) {
      return c.json({ error: 'Application not found' }, 404);
    }

    return c.json({ message: 'Application removed successfully' });
  },
);

export default router;
