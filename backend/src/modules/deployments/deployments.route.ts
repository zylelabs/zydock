import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import deploymentModel from './deployment.model';
import {
  DeploymentIdParam,
  deploymentIdParamSchema,
  ListDeploymentsQuery,
  listDeploymentsQuerySchema,
} from './deployment.schema';
import {
  findDeployment,
  serializeDeployment,
  serializeDeploymentDetail,
} from './deployment.service';
import { deploymentsDocs } from './deployments.docs';

const { router, get } = createRouter();

get(
  '/',
  deploymentsDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listDeploymentsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { applicationId, status } = c.req.valid('query' as never) as ListDeploymentsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await deploymentModel.paginate(
      {
        organizationId,
        ...(applicationId ? { applicationId } : {}),
        ...(status ? { status } : {}),
      },
      { page, size, sort: sort ?? 'createdAt', order: order ?? 'desc' },
    );

    return c.json({ ...result, items: result.items.map(serializeDeployment) });
  },
);

get(
  '/:deploymentId',
  deploymentsDocs.get,
  authMiddleware,
  validator('param', deploymentIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, deploymentId } = c.req.valid('param' as never) as DeploymentIdParam;

    const deployment = await findDeployment(organizationId, deploymentId);

    if (!deployment) {
      return c.json({ error: 'Deployment not found' }, 404);
    }

    return c.json({ deployment: serializeDeploymentDetail(deployment) });
  },
);

export default router;
