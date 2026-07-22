import type { Context, Next } from 'hono';
import { isSuperuser } from '../users/user.service';
import { type OrganizationRole } from './membership.schema';
import { findMembership, hasRole } from './membership.service';

declare module 'hono' {
  interface ContextVariableMap {
    organizationRole: OrganizationRole;
  }
}

export const createOrganizationRoleGuard = (minimumRole: OrganizationRole) => {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth');
    const organizationId = c.req.param('organizationId');

    if (!organizationId) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    if (isSuperuser(auth.email)) {
      c.set('organizationRole', 'owner');

      return next();
    }

    const membership = await findMembership(organizationId, auth.sub);

    if (!membership) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    if (!hasRole(membership.role, minimumRole)) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    c.set('organizationRole', membership.role);

    return next();
  };
};
