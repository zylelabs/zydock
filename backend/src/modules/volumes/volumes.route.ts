import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware } from '../auth/auth.middleware';
import { serverRuntimeMiddleware } from '../containers/container.middleware';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { volumesDocs } from './volumes.docs';
import {
  CreateVolumeDTO,
  createVolumeSchema,
  VolumeNameParam,
  volumeNameParamSchema,
} from './volumes.schema';

const { router, get, post, delete: del } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get(
  '/',
  volumesDocs.list,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    try {
      return c.json(await c.get('runtime').listVolumes());
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/',
  volumesDocs.create,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createVolumeSchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('json' as never) as CreateVolumeDTO;

    try {
      return c.json(await c.get('runtime').createVolume(name), 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

del(
  '/:name',
  volumesDocs.remove,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('admin'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;

    try {
      await c.get('runtime').removeVolume(name);

      return c.json({ message: 'Volume removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
