import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { revokeAllUserApiKeys } from '../auth/api-key.service';
import { authMiddleware, requireSuperuser, requireUserSession } from '../auth/auth.middleware';
import { revokeAllUserSessions } from '../auth/session.service';
import userModel from './user.model';
import {
  ChangePasswordDTO,
  changePasswordSchema,
  IdParam,
  idParamSchema,
  UpdateMeDTO,
  updateMeSchema,
  UpdateUserDTO,
  updateUserSchema,
} from './user.schema';
import { hashPassword, serializeUser, verifyPassword } from './user.service';
import { usersDocs } from './users.docs';

const { router, get, post, patch, delete: del } = createRouter();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applyProfileUpdate = (body: UpdateMeDTO | UpdateUserDTO) => {
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    update.name = body.name;
  }

  if (body.avatar !== undefined) {
    update.avatar = body.avatar;
  }

  return update;
};

get('/me', usersDocs.me, authMiddleware, async (c: Context) => {
  const auth = c.get('auth');

  const user = await userModel.findById(auth.sub);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ user: serializeUser(user) });
});

patch(
  '/me',
  usersDocs.updateMe,
  authMiddleware,
  validator('json', updateMeSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const body = c.req.valid('json' as never) as UpdateMeDTO;

    await userModel.updateOne({ _id: auth.sub }, { $set: applyProfileUpdate(body) });

    const user = await userModel.findById(auth.sub);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user: serializeUser(user) });
  },
);

post(
  '/me/password',
  usersDocs.changePassword,
  authMiddleware,
  requireUserSession,
  validator('json', changePasswordSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const body = c.req.valid('json' as never) as ChangePasswordDTO;

    const user = await userModel.findById(auth.sub).select('+password');

    if (!user?.password) {
      return c.json({ error: 'User not found' }, 404);
    }

    const isValid = await verifyPassword(body.currentPassword, user.password);

    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    await userModel.updateOne(
      { _id: auth.sub },
      { $set: { password: await hashPassword(body.newPassword) } },
    );

    await revokeAllUserSessions(auth.sub, auth.sid);

    return c.json({ message: 'Password changed successfully' });
  },
);

get('/', usersDocs.list, authMiddleware, requireSuperuser, async (c: Context) => {
  const { page, size, sort, order } = paginationQuery(c);

  const search = c.req.query('search');
  const status = c.req.query('status');

  const filter: Record<string, unknown> = {};

  if (status) {
    filter.status = status;
  }

  if (search) {
    const term = escapeRegex(search);

    filter.$or = [
      { email: { $regex: term, $options: 'i' } },
      { name: { $regex: term, $options: 'i' } },
    ];
  }

  const result = await userModel.paginate(filter, { page, size, sort, order });

  return c.json({ ...result, items: result.items.map(serializeUser) });
});

get(
  '/:id',
  usersDocs.get,
  authMiddleware,
  requireSuperuser,
  validator('param', idParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as IdParam;

    const user = await userModel.findById(id);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user: serializeUser(user) });
  },
);

patch(
  '/:id',
  usersDocs.update,
  authMiddleware,
  requireSuperuser,
  validator('param', idParamSchema),
  validator('json', updateUserSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { id } = c.req.valid('param' as never) as IdParam;
    const body = c.req.valid('json' as never) as UpdateUserDTO;

    if (id === auth.sub) {
      return c.json({ error: 'Use the /users/me endpoints to manage your own account' }, 400);
    }

    const update = applyProfileUpdate(body);

    if (body.status !== undefined) {
      update.status = body.status;
    }

    const result = await userModel.updateOne({ _id: id }, { $set: update });

    if (!result.matchedCount) {
      return c.json({ error: 'User not found' }, 404);
    }

    if (body.status === 'disabled') {
      await revokeAllUserSessions(id);
      await revokeAllUserApiKeys(id);
    }

    const user = await userModel.findById(id);

    return c.json({ user: serializeUser(user!) });
  },
);

del(
  '/:id',
  usersDocs.remove,
  authMiddleware,
  requireSuperuser,
  validator('param', idParamSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { id } = c.req.valid('param' as never) as IdParam;

    if (id === auth.sub) {
      return c.json({ error: 'You cannot disable your own account' }, 400);
    }

    const result = await userModel.updateOne({ _id: id }, { $set: { status: 'disabled' } });

    if (!result.matchedCount) {
      return c.json({ error: 'User not found' }, 404);
    }

    await revokeAllUserSessions(id);
    await revokeAllUserApiKeys(id);

    return c.json({ message: 'User disabled successfully' });
  },
);

export default router;
