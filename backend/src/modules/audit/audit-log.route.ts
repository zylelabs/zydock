import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import auditLogModel from './audit-log.model';
import { auditLogDocs } from './audit-log.docs';
import { ListAuditLogQuery, listAuditLogQuerySchema } from './audit-log.schema';
import { serializeAuditLog } from './audit-log.service';

const { router, get } = createRouter();

get(
  '/',
  auditLogDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('query', listAuditLogQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { serverId, action } = c.req.valid('query' as never) as ListAuditLogQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await auditLogModel.paginate(
      {
        organizationId,
        ...(serverId ? { serverId } : {}),
        ...(action ? { action } : {}),
      },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeAuditLog) });
  },
);

export default router;
