import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { volumesDocs } from './volumes.docs';
import {
  CreateVolumeDTO,
  createVolumeSchema,
  VolumeNameParam,
  volumeNameParamSchema,
} from './volumes.schema';

const { router, get, post, delete: del } = createRouter();

const containers = resolveContainerProvider();

get('/', volumesDocs.list, agentAuthMiddleware, async (c: Context) =>
  c.json(await containers.listVolumes()),
);

post(
  '/',
  volumesDocs.create,
  agentAuthMiddleware,
  validator('json', createVolumeSchema),
  async (c: Context) => {
    const { name } = c.req.valid('json' as never) as CreateVolumeDTO;

    try {
      return c.json(await containers.createVolume(name), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

del(
  '/:name',
  volumesDocs.remove,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;

    try {
      await containers.removeVolume(name);

      return c.json({ message: 'Volume removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
