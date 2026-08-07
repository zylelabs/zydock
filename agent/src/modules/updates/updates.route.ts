import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { updatesDocs } from './updates.docs';
import {
  runIdParamSchema,
  startUpdateSchema,
  type RunIdParam,
  type StartUpdateDTO,
} from './updates.schema';
import { installIssue, readUpdateRun, startUpdateRun } from './updates.service';

const { router, get, post } = createRouter();

post(
  '/runs',
  updatesDocs.start,
  agentAuthMiddleware,
  validator('json', startUpdateSchema),
  async (c: Context) => {
    const payload = c.req.valid('json' as never) as StartUpdateDTO;

    const issue = await installIssue();

    if (issue) {
      return c.json({ error: issue }, 400);
    }

    const active = await readUpdateRun();

    if (active?.status === 'running') {
      return c.json({ error: `Update ${active.id} is already running` }, 409);
    }

    try {
      return c.json(await startUpdateRun(payload), 202);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/runs/:runId',
  updatesDocs.read,
  agentAuthMiddleware,
  validator('param', runIdParamSchema),
  async (c: Context) => {
    const { runId } = c.req.valid('param' as never) as RunIdParam;

    const run = await readUpdateRun(runId);

    if (!run) {
      return c.json({ error: `Update run ${runId} not found` }, 404);
    }

    return c.json(run);
  },
);

export default router;
