import type { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import config from '../../config';
import { logWarn } from '../../utils/logger';
import { findActiveUserById, isSuperuser } from '../users/user.service';
import { findActiveApiKey, touchApiKey } from './api-key.service';

export type AuthPayload = {
  sub: string;
  email: string;
  sid?: string;
  keyId?: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthPayload;
  }
}

export const verifyAccessToken = async (token: string): Promise<AuthPayload | null> => {
  try {
    const payload = await verify(token, config.jwt.secret, 'HS256');

    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
};

const authenticateApiKey = async (token: string): Promise<AuthPayload | null> => {
  const apiKey = await findActiveApiKey(token);

  if (!apiKey) {
    return null;
  }

  const user = await findActiveUserById(String(apiKey.userId));

  if (!user) {
    return null;
  }

  await touchApiKey(String(apiKey._id));

  return { sub: String(user._id), email: user.email, keyId: String(apiKey._id) };
};

export const authMiddleware = async (c: Context, next: Next) => {
  const apiKey = c.req.header('X-API-Key');

  if (apiKey) {
    const authenticated = await authenticateApiKey(apiKey);

    if (!authenticated) {
      return c.json({ error: 'Invalid or expired API key' }, 401);
    }

    c.set('auth', authenticated);

    return next();
  }

  const authorization = c.req.header('Authorization');

  if (!authorization) {
    return c.json({ error: 'Credentials not provided' }, 401);
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return c.json({ error: 'Invalid authorization format' }, 401);
  }

  const payload = await verifyAccessToken(token);

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('auth', payload);

  return next();
};

export const requireUserSession = async (c: Context, next: Next) => {
  const auth = c.get('auth');

  if (!auth.sid) {
    return c.json({ error: 'This endpoint requires a user session' }, 403);
  }

  return next();
};

export const requireSuperuser = async (c: Context, next: Next) => {
  const auth = c.get('auth');

  if (!isSuperuser(auth.email)) {
    logWarn('Superuser action denied', { userId: auth.sub, path: c.req.path });

    return c.json({ error: 'Permission denied' }, 403);
  }

  return next();
};
