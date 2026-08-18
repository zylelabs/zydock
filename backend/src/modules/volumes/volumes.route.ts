import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { logInfo } from '../../utils/logger';
import { authMiddleware } from '../auth/auth.middleware';
import { serverRuntimeMiddleware } from '../containers/container.middleware';
import {
  isResourceProtected,
  PROTECTED_RESOURCE_MESSAGE,
  PROTECTED_RESOURCE_STATUS,
} from '../containers/protection.service';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { serverIdParamSchema } from '../servers/server.schema';
import { volumesDocs } from './volumes.docs';
import {
  CreateVolumeDirectoryDTO,
  createVolumeDirectorySchema,
  CreateVolumeDTO,
  createVolumeSchema,
  VolumeNameParam,
  volumeNameParamSchema,
  VolumePathQuery,
  volumePathQuerySchema,
} from './volumes.schema';

const { router, get, put, post, delete: del } = createRouter();

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
    const runtime = c.get('runtime');

    try {
      if (await isResourceProtected(runtime, 'volume', name)) {
        return c.json({ error: PROTECTED_RESOURCE_MESSAGE }, PROTECTED_RESOURCE_STATUS);
      }

      await runtime.removeVolume(name);

      return c.json({ message: 'Volume removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/:name/files',
  volumesDocs.listFiles,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', volumePathQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;

    try {
      return c.json(await c.get('runtime').listVolumeFiles(name, path));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/:name/files/content',
  volumesDocs.readFile,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', volumePathQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;

    try {
      const stream = await c.get('runtime').readVolumeFile(name, path);

      return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (error) {
      return failed(c, error);
    }
  },
);

put(
  '/:name/files/content',
  volumesDocs.writeFile,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('query', volumePathQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { organizationId, serverId, name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;
    const auth = c.get('auth');
    const body = c.req.raw.body;

    if (!body) {
      return c.json({ error: 'The request has no body to write' }, 400);
    }

    try {
      await c.get('runtime').writeVolumeFile(name, path, body);

      logInfo('Volume file written', {
        organizationId,
        serverId,
        volume: name,
        path,
        user: auth.sub,
      });

      return c.json({ message: 'File written' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/:name/files/directory',
  volumesDocs.createDirectory,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createVolumeDirectorySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { organizationId, serverId, name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('json' as never) as CreateVolumeDirectoryDTO;
    const auth = c.get('auth');

    try {
      await c.get('runtime').createVolumeDirectory(name, path);

      logInfo('Volume directory created', {
        organizationId,
        serverId,
        volume: name,
        path,
        user: auth.sub,
      });

      return c.json({ message: 'Directory created' }, 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

del(
  '/:name/files',
  volumesDocs.removeFile,
  authMiddleware,
  validator('param', volumeNameParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('query', volumePathQuerySchema),
  serverRuntimeMiddleware,
  async (c: Context) => {
    const { organizationId, serverId, name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;
    const auth = c.get('auth');

    try {
      await c.get('runtime').deleteVolumePath(name, path);

      logInfo('Volume path removed', {
        organizationId,
        serverId,
        volume: name,
        path,
        user: auth.sub,
      });

      return c.json({ message: 'Path removed' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
