import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import applicationModel from '../applications/application.model';
import { decryptSecret } from '../../utils/crypto';
import { recordServerMetrics } from '../metrics/metric.service';
import { publish } from '../websocket/websocket.service';
import { HeartbeatDTO, heartbeatSchema } from './heartbeat.schema';
import serverModel from './server.model';
import { serversDocs } from './servers.docs';

const { router, get, post } = createRouter();

post(
  '/heartbeat/:serverId',
  serversDocs.heartbeat,
  validator('json', heartbeatSchema),
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

    const body = c.req.valid('json' as never) as HeartbeatDTO;

    await serverModel.updateOne(
      { _id: serverId },
      {
        $set: {
          status: 'online',
          'agent.version': body.version,
          'agent.lastHeartbeatAt': new Date(),
          ...(body.dockerVersion ? { 'resources.dockerVersion': body.dockerVersion } : {}),
        },
      },
    );

    if (body.metrics) {
      publish(`server:${serverId}:metrics`, 'server.metrics', body.metrics);

      await recordServerMetrics(serverId, body.metrics);
    }

    return c.json({ message: 'Heartbeat accepted' });
  },
);

get('/applications/:applicationId/status', serversDocs.applicationStatus, async (c: Context) => {
  const applicationId = c.req.param('applicationId');
  const token = c.req.header('X-Agent-Token');

  if (!applicationId || !token) {
    return c.json({ error: 'Invalid agent token' }, 401);
  }

  const application = await applicationModel.findById(applicationId);

  if (!application) {
    return c.json({ error: 'Application not found' }, 404);
  }

  const server = await serverModel.findById(application.serverId).select('+agent.token');

  if (!server?.agent.token || decryptSecret(server.agent.token) !== token) {
    return c.json({ error: 'Invalid agent token' }, 401);
  }

  return c.json({ status: application.status });
});

export default router;
