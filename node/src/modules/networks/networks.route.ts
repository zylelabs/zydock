import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { networksDocs } from './networks.docs';
import {
  CreateNetworkDTO,
  createNetworkSchema,
  NetworkNameParam,
  networkNameParamSchema,
} from './networks.schema';

const { router, get, post, delete: del } = createRouter();

const containers = resolveContainerProvider();

get('/', networksDocs.list, agentAuthMiddleware, async (c: Context) =>
  c.json(await containers.listNetworks()),
);

post(
  '/',
  networksDocs.create,
  agentAuthMiddleware,
  validator('json', createNetworkSchema),
  async (c: Context) => {
    const { name } = c.req.valid('json' as never) as CreateNetworkDTO;

    try {
      return c.json(await containers.createNetwork(name), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

del(
  '/:name',
  networksDocs.remove,
  agentAuthMiddleware,
  validator('param', networkNameParamSchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as NetworkNameParam;

    try {
      await containers.removeNetwork(name);

      return c.json({ message: 'Network removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
