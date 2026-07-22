import type { Context, Next } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import config from '../../config';

const expected = Buffer.from(config.agentToken, 'utf8');

const matchesAgentToken = (candidate: string) => {
  const provided = Buffer.from(candidate, 'utf8');

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
};

export const agentAuthMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header('X-Agent-Token');

  if (!token || !matchesAgentToken(token)) {
    return c.json({ error: 'Invalid agent token' }, 401);
  }

  return next();
};
