import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { decryptSecret } from '../../utils/crypto';
import serverModel from '../servers/server.model';
import { accessAggregateDocs } from './access-aggregate.docs';
import { accessAggregateIngestSchema, AccessAggregateIngestDTO } from './access-aggregate.schema';
import { recordAccessAggregates } from './access-aggregate.service';

const { router, post } = createRouter();

post(
  '/proxy-access/:serverId',
  accessAggregateDocs.ingest,
  validator('json', accessAggregateIngestSchema),
  async (c: Context) => {
    const serverId = c.req.param('serverId');
    const token = c.req.header('X-Agent-Token');

    if (!serverId || !token) {
      return c.json({ error: 'Invalid agent token' }, 401);
    }

    const server = await serverModel.findById(serverId).select('+agent.token');

    if (!server?.agent.token) {
      return c.json({ error: 'Server not found' }, 404);
    }

    if (decryptSecret(server.agent.token) !== token) {
      return c.json({ error: 'Invalid agent token' }, 401);
    }

    const body = c.req.valid('json' as never) as AccessAggregateIngestDTO;

    await recordAccessAggregates(serverId, body.buckets);

    return c.json({ message: 'Access aggregates accepted' });
  },
);

export default router;
