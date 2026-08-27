import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware, requireSuperuser } from '../auth/auth.middleware';
import { installationDocs } from './installation.docs';
import { roleChangeSchema, type RoleChangeDTO } from './installation.schema';
import {
  demote,
  dnsChecklist,
  getInstallation,
  promote,
  serializeInstallation,
} from './installation.service';
import { restoreDocs } from './restore.docs';
import {
  restoreFromSnapshotSchema,
  startRestoreSchema,
  type RestoreFromSnapshotDTO,
  type StartRestoreDTO,
} from './restore.schema';
import { getLastRestoreRun, startRestore, startRestoreFromSnapshot } from './restore.service';
import { snapshotsDocs } from './snapshot.docs';
import {
  createSnapshotSchema,
  snapshotIdParamSchema,
  uploadSnapshotQuerySchema,
  type CreateSnapshotDTO,
  type SnapshotIdParam,
  type UploadSnapshotQuery,
} from './snapshot.schema';
import {
  createSnapshot,
  downloadSnapshot,
  findSnapshot,
  listSnapshots,
  removeSnapshot,
  serializeSnapshot,
  uploadSnapshot,
} from './snapshot.service';

const { router, get, post, delete: del } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get('/', installationDocs.get, authMiddleware, requireSuperuser, async (c: Context) =>
  c.json(serializeInstallation(await getInstallation())),
);

post(
  '/demote',
  installationDocs.demote,
  authMiddleware,
  requireSuperuser,
  validator('json', roleChangeSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as RoleChangeDTO;

    return c.json(serializeInstallation(await demote(payload)));
  },
);

post(
  '/promote',
  installationDocs.promote,
  authMiddleware,
  requireSuperuser,
  validator('json', roleChangeSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as RoleChangeDTO;

    try {
      return c.json(serializeInstallation(await promote(payload)));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  },
);

get(
  '/dns-checklist',
  installationDocs.dnsChecklist,
  authMiddleware,
  requireSuperuser,
  async (c: Context) => c.json({ domains: await dnsChecklist() }),
);

get('/snapshots', snapshotsDocs.list, authMiddleware, requireSuperuser, async (c: Context) => {
  const snapshots = await listSnapshots();

  return c.json({ snapshots: snapshots.map(serializeSnapshot) });
});

post(
  '/snapshots',
  snapshotsDocs.create,
  authMiddleware,
  requireSuperuser,
  validator('json', createSnapshotSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as CreateSnapshotDTO;
    const auth = c.get('auth');

    const snapshot = await createSnapshot(payload, auth.sub);

    return c.json({ snapshot: serializeSnapshot(snapshot!) }, 202);
  },
);

post(
  '/snapshots/upload',
  snapshotsDocs.upload,
  authMiddleware,
  requireSuperuser,
  validator('query', uploadSnapshotQuerySchema),
  async (c: Context) => {
    const { fileName } = c.req.valid('query' as never) as UploadSnapshotQuery;
    const auth = c.get('auth');
    const body = c.req.raw.body;

    if (!body) {
      return c.json({ error: 'The request has no body to upload' }, 400);
    }

    try {
      const snapshot = await uploadSnapshot(body, fileName, auth.sub);

      return c.json({ snapshot: serializeSnapshot(snapshot) }, 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/snapshots/:snapshotId/download',
  snapshotsDocs.download,
  authMiddleware,
  requireSuperuser,
  validator('param', snapshotIdParamSchema),
  async (c: Context) => {
    const { snapshotId } = c.req.valid('param' as never) as SnapshotIdParam;
    const snapshot = await findSnapshot(snapshotId);

    if (!snapshot) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }

    if (snapshot.status !== 'completed') {
      return c.json({ error: 'This snapshot has not completed' }, 409);
    }

    try {
      return new Response(await downloadSnapshot(snapshot), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${snapshot._id}.zsnap"`,
        },
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  },
);

del(
  '/snapshots/:snapshotId',
  snapshotsDocs.remove,
  authMiddleware,
  requireSuperuser,
  validator('param', snapshotIdParamSchema),
  async (c: Context) => {
    const { snapshotId } = c.req.valid('param' as never) as SnapshotIdParam;
    const snapshot = await findSnapshot(snapshotId);

    if (!snapshot) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }

    await removeSnapshot(snapshot);

    return c.json({ message: 'Snapshot removed successfully' });
  },
);

post(
  '/snapshots/:snapshotId/restore',
  restoreDocs.runFromSnapshot,
  authMiddleware,
  requireSuperuser,
  validator('param', snapshotIdParamSchema),
  validator('json', restoreFromSnapshotSchema),
  async (c: Context) => {
    const { snapshotId } = c.req.valid('param' as never) as SnapshotIdParam;
    const { passphrase } = c.req.valid('json' as never) as RestoreFromSnapshotDTO;
    const snapshot = await findSnapshot(snapshotId);

    if (!snapshot) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }

    if (snapshot.status !== 'completed') {
      return c.json({ error: 'This snapshot has not completed' }, 409);
    }

    try {
      return c.json(await startRestoreFromSnapshot(snapshot, passphrase), 202);
    } catch (error) {
      return failed(c, error);
    }
  },
);

post(
  '/restore',
  restoreDocs.run,
  authMiddleware,
  requireSuperuser,
  validator('json', startRestoreSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as StartRestoreDTO;

    try {
      return c.json(await startRestore(payload), 202);
    } catch (error) {
      return failed(c, error);
    }
  },
);

get('/restore', restoreDocs.getRun, authMiddleware, requireSuperuser, async (c: Context) => {
  try {
    const run = await getLastRestoreRun();

    if (!run) {
      return c.json({ error: 'No restore has run on this installation yet' }, 404);
    }

    return c.json(run);
  } catch (error) {
    return failed(c, error);
  }
});

export default router;
