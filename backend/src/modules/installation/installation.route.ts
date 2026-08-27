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
import { startRestoreSchema, type StartRestoreDTO } from './restore.schema';
import { getLastRestoreRun, startRestore } from './restore.service';
import { snapshotsDocs } from './snapshot.docs';
import {
  createSnapshotSchema,
  snapshotIdParamSchema,
  type CreateSnapshotDTO,
  type SnapshotIdParam,
} from './snapshot.schema';
import {
  createSnapshot,
  downloadSnapshot,
  findSnapshot,
  listSnapshots,
  removeSnapshot,
  serializeSnapshot,
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
