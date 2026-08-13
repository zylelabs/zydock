import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware } from '../auth/auth.middleware';
import { serverRuntimeMiddleware } from '../containers/container.middleware';
import {
  isResourceProtected,
  PROTECTED_RESOURCE_MESSAGE,
  PROTECTED_RESOURCE_STATUS,
} from '../containers/protection.service';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { networksDocs } from './networks.docs';
import {
  CreateNetworkDTO,
  createNetworkSchema,
  NetworkNameParam,
  networkNameParamSchema,
} from './networks.schema';

const { router, get, post, delete: del } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get(
  '/',
  networksDocs.list,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    try {
      return c.json(await c.get('runtime').listNetworks());
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/',
  networksDocs.create,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createNetworkSchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('json' as never) as CreateNetworkDTO;

    try {
      return c.json(await c.get('runtime').createNetwork(name), 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

del(
  '/:name',
  networksDocs.remove,
  authMiddleware,
  validator('param', networkNameParamSchema),
  createOrganizationRoleGuard('admin'),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as NetworkNameParam;
    const runtime = c.get('runtime');

    try {
      if (await isResourceProtected(runtime, 'network', name)) {
        return c.json({ error: PROTECTED_RESOURCE_MESSAGE }, PROTECTED_RESOURCE_STATUS);
      }

      await runtime.removeNetwork(name);

      return c.json({ message: 'Network removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
