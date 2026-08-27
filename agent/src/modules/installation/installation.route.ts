import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { installationDocs } from './installation.docs';
import {
  createInstallationBundleSchema,
  type CreateInstallationBundleDTO,
} from './installation.schema';
import { buildInstallationBundle } from './installation.service';
import { restoreDocs } from './restore.docs';
import {
  restoreRunIdParamSchema,
  stageBundleParamSchema,
  startRestoreSchema,
  type RestoreRunIdParam,
  type StageBundleParam,
  type StartRestoreDTO,
} from './restore.schema';
import {
  readRestoreRun,
  restoreInstallIssue,
  stageSnapshotBundle,
  startRestoreRun,
} from './restore.service';

const { router, get, post, put } = createRouter();

post(
  '/snapshot',
  installationDocs.snapshot,
  agentAuthMiddleware,
  validator('json', createInstallationBundleSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as CreateInstallationBundleDTO;

    try {
      const bundle = await buildInstallationBundle(payload);

      return new Response(bundle, { headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

put(
  '/snapshots/:snapshotId/bundle',
  restoreDocs.stageBundle,
  agentAuthMiddleware,
  validator('param', stageBundleParamSchema),
  async (c: Context) => {
    const { snapshotId } = c.req.valid('param' as never) as StageBundleParam;
    const body = c.req.raw.body;

    if (!body) {
      return c.json({ error: 'The request has no body to stage' }, 400);
    }

    try {
      const { path } = await stageSnapshotBundle(snapshotId, body);

      return c.json({ path }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/restore/runs',
  restoreDocs.start,
  agentAuthMiddleware,
  validator('json', startRestoreSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as StartRestoreDTO;

    const issue = await restoreInstallIssue();

    if (issue) {
      return c.json({ error: issue }, 400);
    }

    const active = await readRestoreRun();

    if (active?.status === 'running') {
      return c.json({ error: `Restore ${active.id} is already running` }, 409);
    }

    try {
      return c.json(await startRestoreRun(payload), 202);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/restore/runs/:runId',
  restoreDocs.read,
  agentAuthMiddleware,
  validator('param', restoreRunIdParamSchema),
  async (c: Context) => {
    const { runId } = c.req.valid('param' as never) as RestoreRunIdParam;

    const run = await readRestoreRun(runId);

    if (!run) {
      return c.json({ error: `Restore run ${runId} not found` }, 404);
    }

    return c.json(run);
  },
);

export default router;
