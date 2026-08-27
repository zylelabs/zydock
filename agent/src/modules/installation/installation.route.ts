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
  startRestoreSchema,
  type RestoreRunIdParam,
  type StartRestoreDTO,
} from './restore.schema';
import { readRestoreRun, restoreInstallIssue, startRestoreRun } from './restore.service';

const { router, get, post } = createRouter();

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
