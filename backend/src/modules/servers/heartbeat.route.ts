import type { Context } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { createRouter, validator } from 'hono-route-docs';
import { getConnInfo } from 'hono/bun';
import config from '../../config';
import applicationModel from '../applications/application.model';
import { decryptSecret } from '../../utils/crypto';
import { recordServerMetrics } from '../metrics/metric.service';
import { publish } from '../websocket/websocket.service';
import { HeartbeatDTO, heartbeatSchema } from './heartbeat.schema';
import { getLocalServerId } from './local-server.service';
import serverModel from './server.model';
import { resolveHeartbeatPublicIp } from './server.service';
import { serversDocs } from './servers.docs';

const { router, get, post } = createRouter();

const matchesLocalToken = (candidate: string) => {
  const expected = Buffer.from(config.localServer.token, 'utf8');
  const provided = Buffer.from(candidate, 'utf8');

  if (!expected.length || provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
};

const resolveConnectionIp = (c: Context) => {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
};

post(
  '/heartbeat/:serverId',
  serversDocs.heartbeat,
  validator('json', heartbeatSchema),
  async (c: Context) => {
    const serverId = c.req.param('serverId');
    const token = c.req.header('X-Agent-Token');

    if (!serverId || serverId.length !== 24 || !token) {
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

    const forwardedFor = c.req.header('X-Forwarded-For');
    const connectionIp = forwardedFor
      ? forwardedFor
          .split(',')
          .map(part => part.trim())
          .filter(Boolean)
          .pop()
      : resolveConnectionIp(c);

    const resolvedPublicIp = resolveHeartbeatPublicIp(connectionIp, body.publicIp);

    await serverModel.updateOne(
      { _id: serverId },
      {
        $set: {
          status: 'online',
          'agent.version': body.version,
          'agent.lastHeartbeatAt': new Date(),
          ...(body.dockerVersion ? { 'resources.dockerVersion': body.dockerVersion } : {}),
          ...(body.composeVersion ? { 'resources.composeVersion': body.composeVersion } : {}),
          ...(resolvedPublicIp && !server.publicIp ? { publicIp: resolvedPublicIp } : {}),
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

get('/identity', serversDocs.identity, async (c: Context) => {
  const token = c.req.header('X-Agent-Token');

  if (!token || !matchesLocalToken(token)) {
    return c.json({ error: 'Invalid agent token' }, 401);
  }

  const serverId = getLocalServerId();

  if (!serverId) {
    return c.json({ error: 'The local server has not been bootstrapped yet' }, 503);
  }

  return c.json({ serverId });
});

get('/applications/:applicationId/status', serversDocs.applicationStatus, async (c: Context) => {
  const applicationId = c.req.param('applicationId');
  const token = c.req.header('X-Agent-Token');

  if (!applicationId || applicationId.length !== 24 || !token) {
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
