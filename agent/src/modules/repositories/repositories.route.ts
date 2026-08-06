import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { repositoriesDocs } from './repositories.docs';
import { CloneDTO, cloneSchema, WorkspaceParam, workspaceParamSchema } from './repositories.schema';
import { cloneRepository, removeWorkspace } from './repositories.service';

const { router, post, delete: del } = createRouter();

const CLONE_KEEPALIVE_MS = 15000;

post(
  '/clone',
  repositoriesDocs.clone,
  agentAuthMiddleware,
  validator('json', cloneSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as CloneDTO;

    return streamSSE(c, async stream => {
      let queue = Promise.resolve();

      const write = (event: string, data: unknown) => {
        queue = queue
          .then(() =>
            stream.aborted || stream.closed
              ? undefined
              : stream.writeSSE({ event, data: JSON.stringify(data) }),
          )
          .catch(() => undefined);

        return queue;
      };

      const keepalive = setInterval(() => void write('ping', {}), CLONE_KEEPALIVE_MS);

      stream.onAbort(() => clearInterval(keepalive));

      try {
        const result = await cloneRepository(body, entry => void write('log', entry));

        await write('result', result);
      } catch (error) {
        await write('error', { error: errorMessage(error) });
      } finally {
        clearInterval(keepalive);
      }
    });
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
