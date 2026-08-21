import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { assertManagedVolume, protectedResourceStatus } from '../containers/protection.service';
import { filesDocs } from './files.docs';
import {
  CreateDirectoryDTO,
  createDirectorySchema,
  VolumeNameParam,
  volumeNameParamSchema,
  VolumePathQuery,
  volumePathQuerySchema,
} from './files.schema';
import { createDirectory, listFiles, readFile, removePath, writeFile } from './files.service';

const { router, get, put, post, delete: del } = createRouter();

const statusForError = (error: unknown) => {
  const protectedStatus = protectedResourceStatus(error);

  if (protectedStatus) {
    return protectedStatus;
  }

  const message = errorMessage(error);

  return message.includes('not found') || message.startsWith('Not a') ? 404 : 400;
};

get(
  '/:name/files',
  filesDocs.list,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('query', volumePathQuerySchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;

    try {
      await assertManagedVolume(name);

      return c.json(await listFiles(name, path));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, statusForError(error));
    }
  },
);

get(
  '/:name/files/content',
  filesDocs.readContent,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('query', volumePathQuerySchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;

    try {
      await assertManagedVolume(name);

      const stream = await readFile(name, path);

      return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, statusForError(error));
    }
  },
);

put(
  '/:name/files/content',
  filesDocs.writeContent,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('query', volumePathQuerySchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;
    const body = c.req.raw.body;

    if (!body) {
      return c.json({ error: 'The request has no body to write' }, 400);
    }

    try {
      await assertManagedVolume(name);
      await writeFile(name, path, body);

      return c.json({ message: 'File written' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, statusForError(error));
    }
  },
);

post(
  '/:name/files/directory',
  filesDocs.createDirectory,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('json', createDirectorySchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('json' as never) as CreateDirectoryDTO;

    try {
      await assertManagedVolume(name);
      await createDirectory(name, path);

      return c.json({ message: 'Directory created' }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, statusForError(error));
    }
  },
);

del(
  '/:name/files',
  filesDocs.remove,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('query', volumePathQuerySchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { path } = c.req.valid('query' as never) as VolumePathQuery;

    try {
      await assertManagedVolume(name);
      await removePath(name, path);

      return c.json({ message: 'Path removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, statusForError(error));
    }
  },
);

export default router;
