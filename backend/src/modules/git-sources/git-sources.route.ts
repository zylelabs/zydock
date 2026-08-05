import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { countApplicationsOfGitSource } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { paginationQuery } from '../../utils/pagination';
import gitSourceModel from './git-source.model';
import {
  CreateManifestDTO,
  createManifestSchema,
  GitSourceIdParam,
  gitSourceIdParamSchema,
  GitSourceInstallationParam,
  gitSourceInstallationParamSchema,
  ManifestCallbackDTO,
  manifestCallbackSchema,
} from './git-source.schema';
import {
  completeManifestRegistration,
  findGitSource,
  listGitSourceInstallations,
  listGitSourceRepositories,
  serializeGitSource,
  startManifestRegistration,
} from './git-source.service';
import { gitSourcesDocs } from './git-sources.docs';

const { router, get, post, delete: del } = createRouter();

get(
  '/',
  gitSourcesDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await gitSourceModel.paginate({ organizationId }, { page, size, sort, order });

    return c.json({ ...result, items: result.items.map(serializeGitSource) });
  },
);

post(
  '/manifest',
  gitSourcesDocs.manifest,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createManifestSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateManifestDTO;
    const auth = c.get('auth');

    const result = await startManifestRegistration(organizationId, auth.sub, body);

    return c.json(result, 201);
  },
);

post(
  '/callback',
  gitSourcesDocs.callback,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', manifestCallbackSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as ManifestCallbackDTO;

    const gitSource = await completeManifestRegistration(organizationId, body);

    if (!gitSource) {
      return c.json({ error: 'Git source not found' }, 404);
    }

    return c.json({ gitSource: serializeGitSource(gitSource) });
  },
);

get(
  '/:gitSourceId',
  gitSourcesDocs.get,
  authMiddleware,
  validator('param', gitSourceIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, gitSourceId } = c.req.valid('param' as never) as GitSourceIdParam;

    const gitSource = await findGitSource(organizationId, gitSourceId);

    if (!gitSource) {
      return c.json({ error: 'Git source not found' }, 404);
    }

    return c.json({ gitSource: serializeGitSource(gitSource) });
  },
);

get(
  '/:gitSourceId/installations',
  gitSourcesDocs.listInstallations,
  authMiddleware,
  validator('param', gitSourceIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, gitSourceId } = c.req.valid('param' as never) as GitSourceIdParam;

    try {
      const installations = await listGitSourceInstallations(organizationId, gitSourceId);

      if (installations === null) {
        return c.json({ error: 'Git source not found' }, 404);
      }

      return c.json({ items: installations });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
);

get(
  '/:gitSourceId/installations/:installationId/repositories',
  gitSourcesDocs.listRepositories,
  authMiddleware,
  validator('param', gitSourceInstallationParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, gitSourceId, installationId } = c.req.valid(
      'param' as never,
    ) as GitSourceInstallationParam;

    try {
      const repositories = await listGitSourceRepositories(
        organizationId,
        gitSourceId,
        installationId,
      );

      if (repositories === null) {
        return c.json({ error: 'Git source not found' }, 404);
      }

      return c.json({ items: repositories });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
);

del(
  '/:gitSourceId',
  gitSourcesDocs.remove,
  authMiddleware,
  validator('param', gitSourceIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, gitSourceId } = c.req.valid('param' as never) as GitSourceIdParam;

    if (!(await findGitSource(organizationId, gitSourceId))) {
      return c.json({ error: 'Git source not found' }, 404);
    }

    const applications = await countApplicationsOfGitSource(gitSourceId);

    if (applications > 0) {
      return c.json(
        { error: `This git source is used by ${applications} application(s). Remove them first` },
        400,
      );
    }

    await gitSourceModel.deleteOne({ _id: gitSourceId, organizationId });

    return c.json({ message: 'Git source removed successfully' });
  },
);

export default router;
