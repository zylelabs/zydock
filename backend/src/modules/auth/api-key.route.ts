import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { IdParam, idParamSchema } from '../users/user.schema';
import { apiKeyDocs } from './api-key.docs';
import apiKeyModel from './api-key.model';
import { CreateApiKeyDTO, createApiKeySchema } from './api-key.schema';
import { createApiKeyToken, revokeApiKey, serializeApiKey } from './api-key.service';
import { authMiddleware, requireUserSession } from './auth.middleware';

const { router, get, post, delete: del } = createRouter();

const DAY_IN_MS = 24 * 60 * 60 * 1000;

get('/', apiKeyDocs.list, authMiddleware, async (c: Context) => {
  const auth = c.get('auth');
  const { page, size, sort, order } = paginationQuery(c);

  const result = await apiKeyModel.paginate(
    { userId: auth.sub, revokedAt: null },
    { page, size, sort, order },
  );

  return c.json({ ...result, items: result.items.map(serializeApiKey) });
});

post(
  '/',
  apiKeyDocs.create,
  authMiddleware,
  requireUserSession,
  validator('json', createApiKeySchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const body = c.req.valid('json' as never) as CreateApiKeyDTO;

    const { token, prefix, tokenHash } = await createApiKeyToken();

    const apiKey = await apiKeyModel.create({
      userId: auth.sub,
      name: body.name,
      prefix,
      tokenHash,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * DAY_IN_MS) : null,
    });

    return c.json({ apiKey: serializeApiKey(apiKey), token }, 201);
  },
);

del(
  '/:id',
  apiKeyDocs.revoke,
  authMiddleware,
  requireUserSession,
  validator('param', idParamSchema),
  async (c: Context) => {
    const auth = c.get('auth');
    const { id } = c.req.valid('param' as never) as IdParam;

    const revoked = await revokeApiKey(id, auth.sub);

    if (!revoked) {
      return c.json({ error: 'API key not found' }, 404);
    }

    return c.json({ message: 'API key revoked successfully' });
  },
);

export default router;
