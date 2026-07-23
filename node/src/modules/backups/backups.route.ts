import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { backupsDocs } from './backups.docs';
import {
  ArchiveContainerDTO,
  archiveContainerSchema,
  ContainerIdParam,
  containerIdParamSchema,
  RestoreContainerDTO,
  restoreContainerSchema,
  RestoreVolumeDTO,
  restoreVolumeSchema,
  UploadIdParam,
  uploadIdParamSchema,
  VolumeNameParam,
  volumeNameParamSchema,
} from './backups.schema';
import { discardUpload, stageUpload, uploadExists, uploadPath } from './backups.service';

const { router, post, delete: del } = createRouter();

const containers = resolveContainerProvider();

const archiveResponse = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } });

/** Resolves the staged archive or returns the answer to send instead. */
const loadUpload = async (c: Context, upload: string) => {
  if (!(await uploadExists(upload))) {
    return { response: c.json({ error: `Upload ${upload} not found` }, 404) };
  }

  return { path: uploadPath(upload) };
};

post('/uploads', backupsDocs.upload, agentAuthMiddleware, async (c: Context) => {
  const body = c.req.raw.body;

  if (!body) {
    return c.json({ error: 'The request has no body to stage' }, 400);
  }

  try {
    return c.json(await stageUpload(body), 201);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

del(
  '/uploads/:upload',
  backupsDocs.discardUpload,
  agentAuthMiddleware,
  validator('param', uploadIdParamSchema),
  async (c: Context) => {
    const { upload } = c.req.valid('param' as never) as UploadIdParam;

    await discardUpload(upload);

    return c.json({ message: 'Upload discarded' });
  },
);

post(
  '/volumes/:name/archive',
  backupsDocs.archiveVolume,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;

    try {
      return archiveResponse(await containers.archiveVolume(name));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  },
);

post(
  '/volumes/:name/restore',
  backupsDocs.restoreVolume,
  agentAuthMiddleware,
  validator('param', volumeNameParamSchema),
  validator('json', restoreVolumeSchema),
  async (c: Context) => {
    const { name } = c.req.valid('param' as never) as VolumeNameParam;
    const { upload } = c.req.valid('json' as never) as RestoreVolumeDTO;

    const staged = await loadUpload(c, upload);

    if (!staged.path) {
      return staged.response;
    }

    try {
      await containers.restoreVolume(name, staged.path);

      return c.json({ message: 'Volume restored' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    } finally {
      await discardUpload(upload);
    }
  },
);

post(
  '/containers/:containerId/archive',
  backupsDocs.archiveContainer,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  validator('json', archiveContainerSchema),
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { command } = c.req.valid('json' as never) as ArchiveContainerDTO;

    try {
      return archiveResponse(await containers.archiveFromContainer(containerId, command));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/containers/:containerId/restore',
  backupsDocs.restoreContainer,
  agentAuthMiddleware,
  validator('param', containerIdParamSchema),
  validator('json', restoreContainerSchema),
  async (c: Context) => {
    const { containerId } = c.req.valid('param' as never) as ContainerIdParam;
    const { command, upload } = c.req.valid('json' as never) as RestoreContainerDTO;

    const staged = await loadUpload(c, upload);

    if (!staged.path) {
      return staged.response;
    }

    try {
      await containers.restoreIntoContainer(containerId, command, staged.path);

      return c.json({ message: 'Archive restored' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    } finally {
      await discardUpload(upload);
    }
  },
);

export default router;
