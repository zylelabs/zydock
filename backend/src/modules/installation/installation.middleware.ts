import type { Context, Next } from 'hono';
import { isStandby } from './installation.service';

export const blockOnStandby = async (c: Context, next: Next) => {
  if (await isStandby()) {
    return c.json({ error: 'This installation is in standby' }, 409);
  }

  return next();
};
