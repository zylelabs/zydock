import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { countApplicationsOfServer } from '../applications/application.service';
import { countDatabasesOfServer } from '../databases/database.service';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { provisionServer, refreshServerResources } from './provisioning.service';
import serverModel from './server.model';
import {
  CreateServerDTO,
  createServerSchema,
  ServerIdParam,
  serverIdParamSchema,
  UpdateServerDTO,
  updateServerSchema,
  ValidateConnectionDTO,
  validateConnectionSchema,
} from './server.schema';
import { encryptSecret } from '../../utils/crypto';
import {
  encryptSshCredentials,
  findServer,
  findServerWithSecrets,
  generateAgentToken,
  probeConnection,
  serializeServer,
} from './server.service';
import { serversDocs } from './servers.docs';

const { router, get, post, patch, delete: del } = createRouter();

get(
  '/',
  serversDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await serverModel.paginate({ organizationId }, { page, size, sort, order });

    return c.json({ ...result, items: result.items.map(serializeServer) });
  },
);

post(
  '/validate',
  serversDocs.validate,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', validateConnectionSchema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as ValidateConnectionDTO;

    return c.json(await probeConnection(body.ssh));
  },
);

post(
  '/',
  serversDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createServerSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateServerDTO;

    // A `local` server is not reached over SSH: the operator runs the agent by hand, so the
    // backend only mints the shared token and returns it once — there is nothing to probe.
    if (body.type === 'local') {
      const token = generateAgentToken();

      const server = await serverModel.create({
        organizationId,
        name: body.name,
        type: 'local',
        status: 'pending',
        agent: { host: body.agentHost, port: body.agentPort ?? 9000, token: encryptSecret(token) },
      });

      return c.json({ server: serializeServer(server), agentToken: token }, 201);
    }

    const probe = await probeConnection(body.ssh!);

    if (!probe.reachable) {
      return c.json({ error: probe.error ?? 'The SSH connection failed' }, 400);
    }

    const server = await serverModel.create({
      organizationId,
      name: body.name,
      type: 'ssh',
      status: 'pending',
      ssh: { ...encryptSshCredentials(body.ssh!), fingerprint: probe.fingerprint },
      agent: { port: body.agentPort ?? 9000 },
      resources: {
        cpuCount: probe.cpuCount,
        memoryMb: probe.memoryMb,
        diskGb: probe.diskGb,
        osRelease: probe.osRelease,
        dockerVersion: probe.dockerVersion,
      },
    });

    return c.json({ server: serializeServer(server) }, 201);
  },
);

get(
  '/:serverId',
  serversDocs.get,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;

    const server = await serverModel.findOne({ _id: serverId, organizationId });

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    return c.json({ server: serializeServer(server) });
  },
);

patch(
  '/:serverId',
  serversDocs.update,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateServerSchema),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;
    const body = c.req.valid('json' as never) as UpdateServerDTO;

    const server = await serverModel.findOne({ _id: serverId, organizationId });

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      update.name = body.name;
    }

    if (body.ssh) {
      const probe = await probeConnection(body.ssh);

      if (!probe.reachable) {
        return c.json({ error: probe.error ?? 'The SSH connection failed' }, 400);
      }

      update.ssh = { ...encryptSshCredentials(body.ssh), fingerprint: probe.fingerprint };
    }

    await serverModel.updateOne({ _id: serverId }, { $set: update });

    const updated = await serverModel.findById(serverId);

    return c.json({ server: serializeServer(updated!) });
  },
);

post(
  '/:serverId/provision',
  serversDocs.provision,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;

    const server = await findServerWithSecrets(organizationId, serverId);

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    if (server.type === 'local') {
      return c.json(
        { error: 'Local servers are configured by running the agent manually, not over SSH' },
        400,
      );
    }

    return c.json({ steps: await provisionServer(server) });
  },
);

post(
  '/:serverId/refresh',
  serversDocs.refresh,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;

    const server = await findServerWithSecrets(organizationId, serverId);

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    if (server.type === 'local') {
      return c.json({ error: 'Local servers have no SSH connection to refresh' }, 400);
    }

    return c.json(await refreshServerResources(server));
  },
);

del(
  '/:serverId',
  serversDocs.remove,
  authMiddleware,
  validator('param', serverIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, serverId } = c.req.valid('param' as never) as ServerIdParam;

    if (!(await findServer(organizationId, serverId))) {
      return c.json({ error: 'Server not found' }, 404);
    }

    // Removing the server would leave its applications and databases pointing nowhere.
    const applications = await countApplicationsOfServer(serverId);

    if (applications > 0) {
      return c.json(
        {
          error: `This server still runs ${applications} application(s). Move or remove them first`,
        },
        409,
      );
    }

    const databases = await countDatabasesOfServer(serverId);

    if (databases > 0) {
      return c.json(
        { error: `This server still runs ${databases} database(s). Remove them first` },
        409,
      );
    }

    const result = await serverModel.deleteOne({ _id: serverId, organizationId });

    if (!result.deletedCount) {
      return c.json({ error: 'Server not found' }, 404);
    }

    return c.json({ message: 'Server removed successfully' });
  },
);

export default router;
