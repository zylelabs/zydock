import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { environmentDocs } from './environment.docs';
import environmentModel from './environment.model';
import {
  CreateEnvironmentDTO,
  createEnvironmentSchema,
  EnvironmentIdParam,
  environmentIdParamSchema,
  UpdateEnvironmentDTO,
  updateEnvironmentSchema,
} from './environment.schema';
import {
  countEnvironmentsOfProject,
  createEnvironment,
  deleteEnvironment,
  findEnvironment,
  renameEnvironment,
  serializeEnvironment,
} from './environment.service';
import { ProjectIdParam, projectIdParamSchema } from './project.schema';
import { findProject } from './project.service';

const { router, get, post, patch, delete: del } = createRouter();

get(
  '/',
  environmentDocs.list,
  authMiddleware,
  validator('param', projectIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, projectId } = c.req.valid('param' as never) as ProjectIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    if (!(await findProject(organizationId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const result = await environmentModel.paginate({ projectId }, { page, size, sort, order });

    return c.json({ ...result, items: result.items.map(serializeEnvironment) });
  },
);

post(
  '/',
  environmentDocs.create,
  authMiddleware,
  validator('param', projectIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createEnvironmentSchema),
  async (c: Context) => {
    const { organizationId, projectId } = c.req.valid('param' as never) as ProjectIdParam;
    const body = c.req.valid('json' as never) as CreateEnvironmentDTO;

    if (!(await findProject(organizationId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const environment = await createEnvironment(organizationId, projectId, body.name);

    return c.json({ environment: serializeEnvironment(environment) }, 201);
  },
);

get(
  '/:environmentId',
  environmentDocs.get,
  authMiddleware,
  validator('param', environmentIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, projectId, environmentId } = c.req.valid(
      'param' as never,
    ) as EnvironmentIdParam;

    if (!(await findProject(organizationId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const environment = await findEnvironment(projectId, environmentId);

    if (!environment) {
      return c.json({ error: 'Environment not found' }, 404);
    }

    return c.json({ environment: serializeEnvironment(environment) });
  },
);

patch(
  '/:environmentId',
  environmentDocs.update,
  authMiddleware,
  validator('param', environmentIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateEnvironmentSchema),
  async (c: Context) => {
    const { organizationId, projectId, environmentId } = c.req.valid(
      'param' as never,
    ) as EnvironmentIdParam;
    const body = c.req.valid('json' as never) as UpdateEnvironmentDTO;

    if (!(await findProject(organizationId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const environment = await findEnvironment(projectId, environmentId);

    if (!environment) {
      return c.json({ error: 'Environment not found' }, 404);
    }

    const updated = await renameEnvironment(environment, body.name);

    return c.json({ environment: serializeEnvironment(updated!) });
  },
);

del(
  '/:environmentId',
  environmentDocs.remove,
  authMiddleware,
  validator('param', environmentIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, projectId, environmentId } = c.req.valid(
      'param' as never,
    ) as EnvironmentIdParam;

    if (!(await findProject(organizationId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (!(await findEnvironment(projectId, environmentId))) {
      return c.json({ error: 'Environment not found' }, 404);
    }

    if ((await countEnvironmentsOfProject(projectId)) <= 1) {
      return c.json({ error: 'A project must keep at least one environment' }, 409);
    }

    await deleteEnvironment(environmentId);

    return c.json({ message: 'Environment removed successfully' });
  },
);

export default router;
