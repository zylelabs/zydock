import type { Context } from 'hono';
import { createRouter } from 'hono-route-docs';
import { bootstrapDocs } from './bootstrap.docs';
import { bootstrapRequired } from './bootstrap.service';

const { router, get } = createRouter();

get('/status', bootstrapDocs.status, async (c: Context) =>
  c.json({ required: await bootstrapRequired() }),
);

export default router;
