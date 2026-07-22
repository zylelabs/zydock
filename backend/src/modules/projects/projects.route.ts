import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import projectModel from './project.model';
import {
  CreateProjectDTO,
  createProjectSchema,
  ProjectIdParam,
  projectIdParamSchema,
  UpdateProjectDTO,
  updateProjectSchema,
} from './project.schema';
import {
  createProject,
  deleteProject,
  findProject,
  serializeProject,
  updateProject,
} from './project.service';
import { projectsDocs } from './projects.docs';

const { router, get, post, patch, delete: del } = createRouter();

get(
  '/',
  projectsDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await projectModel.paginate({ organizationId }, { page, size, sort, order });

    return c.json({ ...result, items: result.items.map(serializeProject) });
  },
);

post(
  '/',
  projectsDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createProjectSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateProjectDTO;

    const project = await createProject(organizationId, body.name, body.description);

    return c.json({ project: serializeProject(project) }, 201);
  },
);

get(
  '/:projectId',
  projectsDocs.get,
  authMiddleware,
  validator('param', projectIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, projectId } = c.req.valid('param' as never) as ProjectIdParam;

    const project = await findProject(organizationId, projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({ project: serializeProject(project) });
  },
);

patch(
  '/:projectId',
  projectsDocs.update,
  authMiddleware,
  validator('param', projectIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateProjectSchema),
  async (c: Context) => {
    const { organizationId, projectId } = c.req.valid('param' as never) as ProjectIdParam;
    const body = c.req.valid('json' as never) as UpdateProjectDTO;

    const project = await findProject(organizationId, projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const updated = await updateProject(project, body);

    return c.json({ project: serializeProject(updated!) });
  },
);

del(
  '/:projectId',
  projectsDocs.remove,
  authMiddleware,
  validator('param', projectIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, projectId } = c.req.valid('param' as never) as ProjectIdParam;

    const project = await findProject(organizationId, projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    await deleteProject(projectId);

    return c.json({ message: 'Project removed successfully' });
  },
);

export default router;
