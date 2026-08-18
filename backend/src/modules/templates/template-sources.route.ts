import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware, requireSuperuser } from '../auth/auth.middleware';
import {
  createTemplateSourceSchema,
  templateSourceIdParamSchema,
  type CreateTemplateSourceDTO,
  type TemplateSourceIdParam,
} from './template-source.schema';
import {
  createTemplateSource,
  findTemplateSourceById,
  listTemplateSources,
  removeTemplateSource,
  serializeTemplateSource,
  syncTemplateSource,
} from './template-source.service';
import { templateSourcesDocs } from './template-sources.docs';

const { router, get, post, delete: del } = createRouter();

get('/', templateSourcesDocs.list, authMiddleware, requireSuperuser, async (c: Context) => {
  const { page, size, sort, order } = paginationQuery(c);
  const result = await listTemplateSources({ page, size, sort, order });

  return c.json({ ...result, items: result.items.map(serializeTemplateSource) });
});

post(
  '/',
  templateSourcesDocs.create,
  authMiddleware,
  requireSuperuser,
  validator('json', createTemplateSourceSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as CreateTemplateSourceDTO;
    const source = await createTemplateSource(body);

    return c.json({ source: serializeTemplateSource(source) }, 201);
  },
);

post(
  '/:templateSourceId/sync',
  templateSourcesDocs.sync,
  authMiddleware,
  requireSuperuser,
  validator('param', templateSourceIdParamSchema),
  async (c: Context) => {
    const { templateSourceId } = c.req.valid('param' as never) as TemplateSourceIdParam;

    if (!(await findTemplateSourceById(templateSourceId))) {
      return c.json({ error: 'Template source not found' }, 404);
    }

    const source = await syncTemplateSource(templateSourceId);

    return c.json({ source: serializeTemplateSource(source) });
  },
);

del(
  '/:templateSourceId',
  templateSourcesDocs.remove,
  authMiddleware,
  requireSuperuser,
  validator('param', templateSourceIdParamSchema),
  async (c: Context) => {
    const { templateSourceId } = c.req.valid('param' as never) as TemplateSourceIdParam;

    if (!(await findTemplateSourceById(templateSourceId))) {
      return c.json({ error: 'Template source not found' }, 404);
    }

    await removeTemplateSource(templateSourceId);

    return c.json({ message: 'Template source removed successfully' });
  },
);

export default router;
