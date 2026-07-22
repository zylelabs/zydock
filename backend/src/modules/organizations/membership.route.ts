import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import userModel from '../users/user.model';
import { membershipDocs } from './membership.docs';
import membershipModel from './membership.model';
import {
  MemberParam,
  memberParamSchema,
  OrganizationIdParam,
  organizationIdParamSchema,
  UpdateMemberDTO,
  updateMemberSchema,
} from './membership.schema';
import {
  countOwners,
  findMembership,
  removeMembership,
  serializeMembership,
} from './membership.service';
import { createOrganizationRoleGuard } from './organizations.middleware';

const { router, get, patch, delete: del } = createRouter();

get(
  '/',
  membershipDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await membershipModel.paginate({ organizationId }, { page, size, sort, order });

    const users = await userModel.find({
      _id: { $in: result.items.map(membership => membership.userId) },
    });

    const byId = new Map(users.map(user => [String(user._id), user]));

    return c.json({
      ...result,
      items: result.items.map(membership =>
        serializeMembership(membership, byId.get(String(membership.userId))),
      ),
    });
  },
);

del(
  '/me',
  membershipDocs.leave,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const auth = c.get('auth');
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;

    const membership = await findMembership(organizationId, auth.sub);

    if (!membership) {
      return c.json({ error: 'Membership not found' }, 404);
    }

    if (membership.role === 'owner' && (await countOwners(organizationId)) === 1) {
      return c.json({ error: 'The last owner cannot leave the organization' }, 400);
    }

    await removeMembership(organizationId, auth.sub);

    return c.json({ message: 'Left the organization successfully' });
  },
);

patch(
  '/:userId',
  membershipDocs.update,
  authMiddleware,
  validator('param', memberParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateMemberSchema),
  async (c: Context) => {
    const { organizationId, userId } = c.req.valid('param' as never) as MemberParam;
    const body = c.req.valid('json' as never) as UpdateMemberDTO;

    const actorRole = c.get('organizationRole');

    const membership = await findMembership(organizationId, userId);

    if (!membership) {
      return c.json({ error: 'Member not found' }, 404);
    }

    if (actorRole !== 'owner' && (body.role === 'owner' || membership.role === 'owner')) {
      return c.json({ error: 'Only an owner can manage the owner role' }, 403);
    }

    if (
      membership.role === 'owner' &&
      body.role !== 'owner' &&
      (await countOwners(organizationId)) === 1
    ) {
      return c.json({ error: 'The last owner cannot be demoted' }, 400);
    }

    membership.role = body.role;
    await membership.save();

    const user = await userModel.findById(userId);

    return c.json({ member: serializeMembership(membership, user) });
  },
);

del(
  '/:userId',
  membershipDocs.remove,
  authMiddleware,
  validator('param', memberParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, userId } = c.req.valid('param' as never) as MemberParam;

    const actorRole = c.get('organizationRole');

    const membership = await findMembership(organizationId, userId);

    if (!membership) {
      return c.json({ error: 'Member not found' }, 404);
    }

    if (membership.role === 'owner' && actorRole !== 'owner') {
      return c.json({ error: 'Only an owner can remove another owner' }, 403);
    }

    if (membership.role === 'owner' && (await countOwners(organizationId)) === 1) {
      return c.json({ error: 'The last owner cannot be removed' }, 400);
    }

    await removeMembership(organizationId, userId);

    return c.json({ message: 'Member removed successfully' });
  },
);

export default router;
