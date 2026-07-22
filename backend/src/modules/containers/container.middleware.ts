import type { Context, Next } from 'hono';
import { resolveContainerProvider, type ContainerProvider } from '../../providers/container';
import { buildAgentConnection, findServerWithAgentToken } from '../servers/server.service';

declare module 'hono' {
  interface ContextVariableMap {
    runtime: ContainerProvider;
  }
}

/**
 * Resolves the container runtime of the server in the path, so that every route of this layer works
 * against the `ContainerProvider` and never against Docker itself. The organization guard runs
 * before this one — reaching here already means the caller belongs to the organization.
 */
export const serverRuntimeMiddleware = async (c: Context, next: Next) => {
  const organizationId = c.req.param('organizationId');
  const serverId = c.req.param('serverId');

  if (!organizationId || !serverId) {
    return c.json({ error: 'Server not found' }, 404);
  }

  const server = await findServerWithAgentToken(organizationId, serverId);

  if (!server) {
    return c.json({ error: 'Server not found' }, 404);
  }

  if (!server.agent.token) {
    return c.json({ error: 'This server has no agent yet: provision it first' }, 409);
  }

  c.set('runtime', resolveContainerProvider(buildAgentConnection(server)));

  return next();
};
