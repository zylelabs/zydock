import type { Context, Next } from 'hono';
import { verifyAccessToken } from '../auth/auth.middleware';

export const websocketAuthMiddleware = async (c: Context, next: Next) => {
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: 'Access token not provided' }, 401);
  }

  const payload = await verifyAccessToken(token);

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('auth', payload);

  return next();
};
