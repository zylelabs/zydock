import type { Context, Next } from 'hono';
import { getClientMeta } from '../modules/auth/session.service';
import { logWarn } from './logger';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  windowMs: number;
  max: number;
  identify?: (c: Context) => Promise<string | undefined> | string | undefined;
};

const buckets = new Map<string, RateLimitEntry>();

export const resetRateLimitState = () => {
  buckets.clear();
};

const buildKey = (c: Context, identity: string | undefined) => {
  const { ip } = getClientMeta(c);

  return `${c.req.path}:${ip ?? 'unknown'}:${identity ?? ''}`;
};

export const createRateLimiter = (options: RateLimitOptions) => {
  return async (c: Context, next: Next) => {
    const identity = await options.identify?.(c);
    const key = buildKey(c, identity);
    const now = Date.now();

    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });

      return next();
    }

    if (entry.count >= options.max) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);

      logWarn('Rate limit exceeded', { path: c.req.path, ip: getClientMeta(c).ip });

      c.header('Retry-After', String(retryAfterSeconds));

      return c.json({ error: 'Too many requests' }, 429);
    }

    entry.count += 1;

    return next();
  };
};
