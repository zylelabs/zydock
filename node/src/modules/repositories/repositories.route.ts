import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { repositoriesDocs } from './repositories.docs';
import { CloneDTO, cloneSchema, WorkspaceParam, workspaceParamSchema } from './repositories.schema';
import { cloneRepository, removeWorkspace } from './repositories.service';

const { router, post, delete: del } = createRouter();

post(
  '/clone',
  repositoriesDocs.clone,
  agentAuthMiddleware,
  validator('json', cloneSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as CloneDTO;

    try {
      return c.json(await cloneRepository(body));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

del(
  '/:workspace',
  repositoriesDocs.remove,
  agentAuthMiddleware,
  validator('param', workspaceParamSchema),
  async (c: Context) => {
    const { workspace } = c.req.valid('param' as never) as WorkspaceParam;

    try {
      await removeWorkspace(workspace);

      return c.json({ message: 'Workspace removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
