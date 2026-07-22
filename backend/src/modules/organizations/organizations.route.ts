import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import membershipModel from './membership.model';
import { OrganizationIdParam, organizationIdParamSchema } from './membership.schema';
import organizationModel from './organization.model';
import {
  CreateOrganizationDTO,
  createOrganizationSchema,
  UpdateOrganizationDTO,
  updateOrganizationSchema,
} from './organization.schema';
import {
  createOrganization,
  deleteOrganization,
  serializeOrganization,
} from './organization.service';
import { organizationsDocs } from './organizations.docs';
import { createOrganizationRoleGuard } from './organizations.middleware';

const { router, get, post, patch, delete: del } = createRouter();

get('/', organizationsDocs.list, authMiddleware, async (c: Context) => {
  const auth = c.get('auth');
  const { page, size, sort, order } = paginationQuery(c);

  const result = await membershipModel.paginate({ userId: auth.sub }, { page, size, sort, order });

  const organizations = await organizationModel.find({
    _id: { $in: result.items.map(membership => membership.organizationId) },
  });

  const byId = new Map(organizations.map(organization => [String(organization._id), organization]));

  const items = result.items
    .map(membership => {
      const organization = byId.get(String(membership.organizationId));

      return organization ? serializeOrganization(organization, membership.role) : null;
    })
    .filter(item => item !== null);

  return c.json({ ...result, items });
});

post(
  '/',
  organizationsDocs.create,
  authMiddleware,
  validator('json', createOrganizationSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const body = c.req.valid('json' as never) as CreateOrganizationDTO;

    const organization = await createOrganization(body.name, auth.sub, body.branding);

    return c.json({ organization: serializeOrganization(organization, 'owner') }, 201);
  },
);

get(
  '/:organizationId',
  organizationsDocs.get,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;

    const organization = await organizationModel.findById(organizationId);

    if (!organization) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    return c.json({
      organization: serializeOrganization(organization, c.get('organizationRole')),
    });
  },
);

patch(
  '/:organizationId',
  organizationsDocs.update,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateOrganizationSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as UpdateOrganizationDTO;

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      update.name = body.name;
    }

    for (const [key, value] of Object.entries(body.branding ?? {})) {
      update[`branding.${key}`] = value;
    }

    const result = await organizationModel.updateOne({ _id: organizationId }, { $set: update });

    if (!result.matchedCount) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const organization = await organizationModel.findById(organizationId);

    return c.json({
      organization: serializeOrganization(organization!, c.get('organizationRole')),
    });
  },
);

del(
  '/:organizationId',
  organizationsDocs.remove,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('owner'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;

    await deleteOrganization(organizationId);

    return c.json({ message: 'Organization deleted successfully' });
  },
);

export default router;
