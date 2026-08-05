import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { findDeployment, serializeDeployment } from '../deployments/deployment.service';
import {
  RollbackDTO,
  rollbackSchema,
  TriggerDeploymentDTO,
  triggerDeploymentSchema,
} from '../deployments/deployment.schema';
import { enqueueDeployment, enqueueRollback } from '../deployments/pipeline.service';
import { findGitSource } from '../git-sources/git-source.service';
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
  removeApplication,
  replaceVariables,
  serializeApplication,
  updateApplication,
} from './application.service';
import { applicationsDocs } from './applications.docs';
import { LifecycleAction, runLifecycleAction } from './lifecycle.service';
import { webhookDocs } from './webhook.docs';
import { configureWebhook, removeWebhook } from './webhook.service';

const { router, get, post, patch, put, delete: del } = createRouter();

const isGitSourceUsable = async (organizationId: string, gitSourceId: string) => {
  const gitSource = await findGitSource(organizationId, gitSourceId);

  return Boolean(gitSource && gitSource.status === 'active');
};

const lifecycleHandler = (action: LifecycleAction) => async (c: Context) => {
  const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

  const application = await findApplication(organizationId, applicationId);

  if (!application) {
    return c.json({ error: 'Application not found' }, 404);
  }

  try {
    await runLifecycleAction(application, action);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const updated = await findApplication(organizationId, applicationId);

  return c.json({ application: serializeApplication(updated!) });
};

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

    if (
      body.git.source === 'github-app' &&
      !(await isGitSourceUsable(organizationId, body.git.gitSourceId!))
    ) {
      return c.json({ error: 'Git source not found or not active in this organization' }, 400);
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

    if (
      body.git?.source === 'github-app' &&
      !(await isGitSourceUsable(organizationId, body.git.gitSourceId!))
    ) {
      return c.json({ error: 'Git source not found or not active in this organization' }, 400);
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

post(
  '/:applicationId/deploy',
  applicationsDocs.deploy,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', triggerDeploymentSchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
    const body = c.req.valid('json' as never) as TriggerDeploymentDTO;
    const auth = c.get('auth');

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const deployment = await enqueueDeployment({
      application,
      trigger: 'manual',
      triggeredBy: auth.sub,
      branch: body.branch,
      commit: body.commit,
    });

    return c.json({ deployment: serializeDeployment(deployment) }, 202);
  },
);

post(
  '/:applicationId/rollback',
  applicationsDocs.rollback,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', rollbackSchema),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;
    const body = c.req.valid('json' as never) as RollbackDTO;
    const auth = c.get('auth');

    const application = await findApplication(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    const source = await findDeployment(organizationId, body.deploymentId);

    if (!source || String(source.applicationId) !== applicationId) {
      return c.json({ error: 'Deployment not found for this application' }, 404);
    }

    if (source.status !== 'succeeded' || !source.imageTag) {
      return c.json(
        { error: 'Only a successful deployment with a built image can be rolled back to' },
        400,
      );
    }

    const deployment = await enqueueRollback({ application, source, triggeredBy: auth.sub });

    return c.json({ deployment: serializeDeployment(deployment) }, 202);
  },
);

post(
  '/:applicationId/restart',
  applicationsDocs.restart,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  lifecycleHandler('restart'),
);

post(
  '/:applicationId/stop',
  applicationsDocs.stop,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  lifecycleHandler('stop'),
);

post(
  '/:applicationId/start',
  applicationsDocs.start,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  lifecycleHandler('start'),
);

post(
  '/:applicationId/webhook',
  webhookDocs.configure,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplicationWithSecrets(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    if (application.git.source === 'github-app') {
      return c.json(
        { error: 'This application receives pushes through the GitHub App, no webhook to create' },
        400,
      );
    }

    try {
      return c.json({ webhook: await configureWebhook(application) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
);

del(
  '/:applicationId/webhook',
  webhookDocs.remove,
  authMiddleware,
  validator('param', applicationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, applicationId } = c.req.valid('param' as never) as ApplicationIdParam;

    const application = await findApplicationWithSecrets(organizationId, applicationId);

    if (!application) {
      return c.json({ error: 'Application not found' }, 404);
    }

    if (application.git.source === 'github-app') {
      return c.json(
        { error: 'This application receives pushes through the GitHub App, no webhook to remove' },
        400,
      );
    }

    try {
      if (!(await removeWebhook(application))) {
        return c.json({ error: 'This application has no webhook configured' }, 404);
      }

      return c.json({ message: 'Webhook removed successfully' });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
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

    if (!(await findApplication(organizationId, applicationId))) {
      return c.json({ error: 'Application not found' }, 404);
    }

    await removeApplication(applicationId);

    return c.json({ message: 'Application removed successfully' });
  },
);

export default router;
