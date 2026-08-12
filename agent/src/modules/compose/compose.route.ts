import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { composeDocs } from './compose.docs';
import {
  ProjectParam,
  projectParamSchema,
  RestartComposeQuery,
  restartComposeQuerySchema,
  WriteComposeDTO,
  writeComposeSchema,
} from './compose.schema';
import {
  configComposeProject,
  downComposeProject,
  psComposeProject,
  pullComposeProject,
  restartComposeProject,
  upComposeProject,
  writeComposeProject,
} from './compose.service';

const { router, get, post } = createRouter();

const STREAM_KEEPALIVE_MS = 15000;

const streamed = (
  c: Context,
  run: (
    onLog: (entry: { stream: 'stdout' | 'stderr'; message: string }) => void,
  ) => Promise<unknown>,
) =>
  streamSSE(c, async stream => {
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

    const keepalive = setInterval(() => void write('ping', {}), STREAM_KEEPALIVE_MS);

    stream.onAbort(() => clearInterval(keepalive));

    try {
      const result = await run(entry => void write('log', entry));

      await write('result', result);
    } catch (error) {
      await write('error', { error: errorMessage(error) });
    } finally {
      clearInterval(keepalive);
    }
  });

post(
  '/:project/files',
  composeDocs.write,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  validator('json', writeComposeSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;
    const body = c.req.valid('json' as never) as WriteComposeDTO;

    try {
      return c.json(await writeComposeProject(project, body), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/:project/config',
  composeDocs.config,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;

    try {
      return c.json(await configComposeProject(project));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  },
);

post(
  '/:project/pull',
  composeDocs.pull,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;

    return streamed(c, onLog => pullComposeProject(project, onLog));
  },
);

post(
  '/:project/up',
  composeDocs.up,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;

    return streamed(c, onLog => upComposeProject(project, onLog));
  },
);

post(
  '/:project/down',
  composeDocs.down,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;

    try {
      await downComposeProject(project, c.req.query('volumes') === 'true');

      return c.json({ message: 'Compose project stopped' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/:project/ps',
  composeDocs.ps,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;

    try {
      return c.json(await psComposeProject(project));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  },
);

post(
  '/:project/restart',
  composeDocs.restart,
  agentAuthMiddleware,
  validator('param', projectParamSchema),
  validator('query', restartComposeQuerySchema),
  async (c: Context) => {
    const { project } = c.req.valid('param' as never) as ProjectParam;
    const { service } = c.req.valid('query' as never) as RestartComposeQuery;

    try {
      await restartComposeProject(project, service);

      return c.json({ message: 'Compose project restarted' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
