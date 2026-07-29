import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { streamSSE } from 'hono/streaming';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { imagesDocs } from './images.docs';
import {
  BuildImageDTO,
  buildImageSchema,
  ImageReferenceDTO,
  imageReferenceSchema,
} from './images.schema';

const { router, get, post, delete: del } = createRouter();

const containers = resolveContainerProvider();

const BUILD_KEEPALIVE_MS = 15000;

get('/', imagesDocs.list, agentAuthMiddleware, async (c: Context) =>
  c.json(await containers.listImages()),
);

post(
  '/pull',
  imagesDocs.pull,
  agentAuthMiddleware,
  validator('json', imageReferenceSchema),
  async (c: Context) => {
    const { reference } = c.req.valid('json' as never) as ImageReferenceDTO;

    try {
      return c.json(await containers.pullImage(reference));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/build',
  imagesDocs.build,
  agentAuthMiddleware,
  validator('json', buildImageSchema),
  async (c: Context) => {
    const spec = c.req.valid('json' as never) as BuildImageDTO;

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

      const keepalive = setInterval(() => void write('ping', {}), BUILD_KEEPALIVE_MS);

      stream.onAbort(() => clearInterval(keepalive));

      try {
        const image = await containers.buildImage({
          ...spec,
          onLog: entry => {
            void write('log', entry);
          },
        });

        await write('result', image);
      } catch (error) {
        await write('error', { error: errorMessage(error) });
      } finally {
        clearInterval(keepalive);
      }
    });
  },
);

del(
  '/',
  imagesDocs.remove,
  agentAuthMiddleware,
  validator('query', imageReferenceSchema),
  async (c: Context) => {
    const { reference } = c.req.valid('query' as never) as ImageReferenceDTO;

    try {
      await containers.removeImage(reference);

      return c.json({ message: 'Image removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

export default router;
