import type { Context, Next } from 'hono';
import type { AuthPayload } from '../auth/auth.middleware';
import { isSuperuser } from '../users/user.service';
import { type OrganizationRole } from './membership.schema';
import { findMembership, hasRole } from './membership.service';

declare module 'hono' {
  interface ContextVariableMap {
    organizationRole: OrganizationRole;
  }
}

export const resolveOrganizationRole = async (
  auth: AuthPayload,
  organizationId: string,
): Promise<OrganizationRole | null> => {
  if (isSuperuser(auth.email)) {
    return 'owner';
  }

  const membership = await findMembership(organizationId, auth.sub);

  return membership ? membership.role : null;
};

export const createOrganizationRoleGuard = (minimumRole: OrganizationRole) => {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth');
    const organizationId = c.req.param('organizationId');

    if (!organizationId) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const role = await resolveOrganizationRole(auth, organizationId);

    if (!role) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    if (!hasRole(role, minimumRole)) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    c.set('organizationRole', role);

    return next();
  };
};
