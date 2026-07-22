import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { IdParam, idParamSchema } from '../users/user.schema';
import { authMiddleware, requireUserSession } from './auth.middleware';
import { sessionDocs } from './session.docs';
import sessionModel from './session.model';
import { revokeAllUserSessions, revokeSession, serializeSession } from './session.service';

const { router, get, delete: del } = createRouter();

get('/', sessionDocs.list, authMiddleware, async (c: Context) => {
  const auth = c.get('auth');
  const { page, size, sort, order } = paginationQuery(c);

  const result = await sessionModel.paginate(
    { userId: auth.sub, revokedAt: null, expiresAt: { $gt: new Date() } },
    { page, size, sort, order },
  );

  return c.json({
    ...result,
    items: result.items.map(session => serializeSession(session, auth.sid)),
  });
});

del('/', sessionDocs.revokeAll, authMiddleware, requireUserSession, async (c: Context) => {
  const auth = c.get('auth');

  const revoked = await revokeAllUserSessions(auth.sub, auth.sid);

  return c.json({ message: `${revoked} session(s) revoked` });
});

del(
  '/:id',
  sessionDocs.revoke,
  authMiddleware,
  validator('param', idParamSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { id } = c.req.valid('param' as never) as IdParam;

    const revoked = await revokeSession(id, auth.sub);

    if (!revoked) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ message: 'Session revoked successfully' });
  },
);

export default router;
