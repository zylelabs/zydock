import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware } from '../auth/auth.middleware';
import { serverRuntimeMiddleware } from '../containers/container.middleware';
import { blockOnStandby } from '../installation/installation.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { imagesDocs } from './images.docs';
import { ImageReferenceDTO, imageReferenceSchema } from './images.schema';

const { router, get, post, delete: del } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get(
  '/',
  imagesDocs.list,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    try {
      return c.json(await c.get('runtime').listImages());
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/pull',
  imagesDocs.pull,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('json', imageReferenceSchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { reference } = c.req.valid('json' as never) as ImageReferenceDTO;

    try {
      return c.json(await c.get('runtime').pullImage(reference));
    } catch (error) {
      return failed(c, error);
    }
  },
);

del(
  '/',
  imagesDocs.remove,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('query', imageReferenceSchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { reference } = c.req.valid('query' as never) as ImageReferenceDTO;

    try {
      await c.get('runtime').removeImage(reference);

      return c.json({ message: 'Image removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
