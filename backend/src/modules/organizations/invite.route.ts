import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import config from '../../config';
import { paginationQuery } from '../../utils/pagination';
import { createRateLimiter } from '../../utils/rate-limit.middleware';
import { authMiddleware, requireUserSession } from '../auth/auth.middleware';
import { inviteDocs } from './invite.docs';
import inviteModel from './invite.model';
import {
  CreateInviteDTO,
  createInviteSchema,
  InviteParam,
  inviteParamSchema,
  InviteTokenDTO,
  inviteTokenSchema,
} from './invite.schema';
import {
  acceptInvite,
  createInvite,
  findActiveInviteByToken,
  revokeInvite,
  sendInviteEmail,
  serializeInvite,
} from './invite.service';
import { OrganizationIdParam, organizationIdParamSchema } from './membership.schema';
import { createMembership, findMembership } from './membership.service';
import organizationModel from './organization.model';
import { serializeOrganization } from './organization.service';
import { createOrganizationRoleGuard } from './organizations.middleware';
import userModel from '../users/user.model';

const { router, get, post, delete: del } = createRouter();

const inviteAcceptRateLimiter = createRateLimiter({
  policy: config.rateLimit.inviteAccept,
  identify: c => c.get('auth').sub,
});

get(
  '/',
  inviteDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await inviteModel.paginate(
      { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeInvite) });
  },
);

post(
  '/',
  inviteDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createInviteSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateInviteDTO;

    const existingUser = await userModel.findOne({ email: body.email });

    if (existingUser && (await findMembership(organizationId, String(existingUser._id)))) {
      return c.json({ error: 'That user is already a member of this organization' }, 409);
    }

    const organization = await organizationModel.findById(organizationId);

    if (!organization) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const { invite, token } = await createInvite({
      organizationId,
      email: body.email,
      role: body.role,
      invitedBy: auth.sub,
    });

    await sendInviteEmail(invite, organization, token);

    return c.json({ invite: serializeInvite(invite) }, 201);
  },
);

get(
  '/preview',
  inviteDocs.preview,
  authMiddleware,
  requireUserSession,
  validator('param', organizationIdParamSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;

    const token = c.req.query('token');

    if (!token) {
      return c.json({ error: 'Invalid or expired invite' }, 400);
    }

    const invite = await findActiveInviteByToken(organizationId, token);

    if (!invite) {
      return c.json({ error: 'Invalid or expired invite' }, 400);
    }

    if (invite.email !== auth.email.toLowerCase()) {
      return c.json({ error: 'This invite belongs to a different e-mail address' }, 403);
    }

    const organization = await organizationModel.findById(organizationId);

    if (!organization) {
      return c.json({ error: 'Invalid or expired invite' }, 400);
    }

    return c.json({ organization: serializeOrganization(organization), role: invite.role });
  },
);

post(
  '/accept',
  inviteDocs.accept,
  authMiddleware,
  requireUserSession,
  validator('param', organizationIdParamSchema),
  validator('json', inviteTokenSchema),
  inviteAcceptRateLimiter,
  async (c: Context) => {
    const auth = c.get('auth');
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as InviteTokenDTO;

    const invite = await findActiveInviteByToken(organizationId, body.token);

    if (!invite) {
      return c.json({ error: 'Invalid or expired invite' }, 400);
    }

    if (invite.email !== auth.email.toLowerCase()) {
      return c.json({ error: 'This invite belongs to a different e-mail address' }, 403);
    }

    if (await findMembership(organizationId, auth.sub)) {
      return c.json({ error: 'You are already a member of this organization' }, 409);
    }

    const organization = await organizationModel.findById(organizationId);

    if (!organization) {
      return c.json({ error: 'Invalid or expired invite' }, 400);
    }

    await createMembership(organizationId, auth.sub, invite.role);
    await acceptInvite(String(invite._id));

    return c.json({
      organization: serializeOrganization(organization, invite.role),
    });
  },
);

del(
  '/:inviteId',
  inviteDocs.revoke,
  authMiddleware,
  validator('param', inviteParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, inviteId } = c.req.valid('param' as never) as InviteParam;

    const revoked = await revokeInvite(organizationId, inviteId);

    if (!revoked) {
      return c.json({ error: 'Invite not found' }, 404);
    }

    return c.json({ message: 'Invite revoked successfully' });
  },
);

export default router;
