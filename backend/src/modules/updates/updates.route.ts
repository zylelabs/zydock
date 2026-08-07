import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware, requireSuperuser } from '../auth/auth.middleware';
import {
  branchIssue,
  runIdParamSchema,
  updateRunSchema,
  updateSettingsSchema,
  type RunIdParam,
  type UpdateRunDTO,
  type UpdateSettingsDTO,
} from './update.schema';
import {
  checkForUpdates,
  getUpdateDocument,
  getUpdateRun,
  saveUpdateSettings,
  serializeUpdateRun,
  serializeUpdateSettings,
  serializeUpdateStatus,
  startUpdateRun,
} from './update.service';
import { updatesDocs } from './updates.docs';

const { router, get, patch, post } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get('/status', updatesDocs.status, authMiddleware, requireSuperuser, async (c: Context) =>
  c.json(serializeUpdateStatus(await getUpdateDocument())),
);

get(
  '/runs/:runId',
  updatesDocs.getRun,
  authMiddleware,
  requireSuperuser,
  validator('param', runIdParamSchema),
  async (c: Context) => {
    const { runId } = c.req.valid('param' as never) as RunIdParam;

    try {
      const run = await getUpdateRun(runId);

      if (!run) {
        return c.json({ error: `Update run ${runId} not found` }, 404);
      }

      return c.json(serializeUpdateRun(run));
    } catch (error) {
      return failed(c, error);
    }
  },
);

get('/settings', updatesDocs.getSettings, authMiddleware, requireSuperuser, async (c: Context) =>
  c.json(serializeUpdateSettings(await getUpdateDocument())),
);

patch(
  '/settings',
  updatesDocs.updateSettings,
  authMiddleware,
  requireSuperuser,
  validator('json', updateSettingsSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as UpdateSettingsDTO;

    const current = await getUpdateDocument();
    const issue = branchIssue(payload.channel ?? current.channel, payload.branch ?? current.branch);

    if (issue) {
      return c.json({ error: issue }, 400);
    }

    return c.json(serializeUpdateSettings(await saveUpdateSettings(payload)));
  },
);

post('/check', updatesDocs.check, authMiddleware, requireSuperuser, async (c: Context) => {
  const result = await checkForUpdates('manual');

  if (!result.checked) {
    return c.json({ error: `Could not check for updates: ${result.error}` }, 502);
  }

  return c.json(serializeUpdateStatus(result.document));
});

post(
  '/run',
  updatesDocs.run,
  authMiddleware,
  requireSuperuser,
  validator('json', updateRunSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as UpdateRunDTO;

    try {
      return c.json(serializeUpdateRun(await startUpdateRun(payload)), 202);
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
