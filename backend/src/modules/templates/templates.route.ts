import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { serializeApplication } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { serializeDeployment } from '../deployments/deployment.service';
import { hasRole } from '../organizations/membership.service';
import { resolveOrganizationRole } from '../organizations/organizations.middleware';
import { findEnvironmentOfOrganization } from '../projects/environment.service';
import { findServer } from '../servers/server.service';
import {
  DeployTemplateDTO,
  deployTemplateSchema,
  ListTemplatesQuery,
  listTemplatesQuerySchema,
  TemplateIdParam,
  templateIdParamSchema,
} from './template.schema';
import {
  deployTemplateApplication,
  findTemplateById,
  listTemplates,
  serializeTemplate,
} from './template.service';
import { templatesDocs } from './templates.docs';

const { router, get, post } = createRouter();

get(
  '/',
  templatesDocs.list,
  authMiddleware,
  validator('query', listTemplatesQuerySchema),
  (c: Context) => {
    const { search, category } = c.req.valid('query' as never) as ListTemplatesQuery;
    const { page, size } = paginationQuery(c);

    return c.json(listTemplates({ search, category, page, size }));
  },
);

get(
  '/:templateId',
  templatesDocs.get,
  authMiddleware,
  validator('param', templateIdParamSchema),
  (c: Context) => {
    const { templateId } = c.req.valid('param' as never) as TemplateIdParam;
    const template = findTemplateById(templateId);

    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json({ template: serializeTemplate(template) });
  },
);

post(
  '/:templateId/deploy',
  templatesDocs.deploy,
  authMiddleware,
  validator('param', templateIdParamSchema),
  validator('json', deployTemplateSchema),
  async (c: Context) => {
    const { templateId } = c.req.valid('param' as never) as TemplateIdParam;
    const body = c.req.valid('json' as never) as DeployTemplateDTO;
    const auth = c.get('auth');

    const role = await resolveOrganizationRole(auth, body.organizationId);

    if (!role) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    if (!hasRole(role, 'admin')) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const template = findTemplateById(templateId);

    if (!template || template.deprecated) {
      return c.json({ error: 'Template not found' }, 404);
    }

    const environment = await findEnvironmentOfOrganization(
      body.organizationId,
      body.environmentId,
    );

    if (!environment) {
      return c.json({ error: 'Environment not found in this organization' }, 400);
    }

    const server = await findServer(body.organizationId, body.serverId);

    if (!server) {
      return c.json({ error: 'Server not found in this organization' }, 400);
    }

    if (!server.resources?.composeVersion) {
      return c.json(
        {
          error:
            'This server has no Docker Compose plugin detected yet — install it on the server ' +
            'and wait for the next agent heartbeat before deploying a template',
        },
        409,
      );
    }

    try {
      const { application, deployment } = await deployTemplateApplication({
        template,
        organizationId: body.organizationId,
        projectId: String(environment.projectId),
        server,
        body,
        triggeredBy: auth.sub,
      });

      return c.json(
        {
          application: serializeApplication(application),
          deployment: deployment ? serializeDeployment(deployment) : undefined,
        },
        201,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
);

export default router;
