import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { blockOnStandby } from '../installation/installation.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerWithAgentToken } from '../servers/server.service';
import databaseModel from './database.model';
import { fetchAllEngineVersions } from './database-versions.service';
import {
  CreateDatabaseDTO,
  createDatabaseSchema,
  DatabaseIdParam,
  databaseIdParamSchema,
  ListDatabasesQuery,
  listDatabasesQuerySchema,
  RemoveDatabaseQuery,
  removeDatabaseQuerySchema,
  UpdateDatabaseAccessDTO,
  updateDatabaseAccessSchema,
} from './database.schema';
import {
  applyDatabaseAccess,
  destroyDatabase,
  ensureDatabaseContainer,
  fetchDatabaseStats,
  fetchOrganizationDatabaseStats,
  findDatabase,
  findDatabaseAccessConflict,
  findDatabaseConsumers,
  findDatabaseWithSecrets,
  provisionDatabase,
  publicConnectionUriOf,
  readCredentials,
  refreshDatabaseStatus,
  runLifecycle,
  serializeDatabase,
} from './database.service';
import { databasesDocs } from './databases.docs';

const { router, get, post, patch, delete: del } = createRouter();

const failed = (c: Context, error: unknown) =>
  c.json({ error: errorMessage(error) }, agentFailureStatus(error));

get(
  '/',
  databasesDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listDatabasesQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { serverId, engine } = c.req.valid('query' as never) as ListDatabasesQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await databaseModel.paginate(
      { organizationId, ...(serverId ? { serverId } : {}), ...(engine ? { engine } : {}) },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(item => serializeDatabase(item)) });
  },
);

post(
  '/',
  databasesDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('json', createDatabaseSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateDatabaseDTO;

    const server = await findServerWithAgentToken(organizationId, body.serverId);

    if (!server) {
      return c.json({ error: 'Server not found in this organization' }, 400);
    }

    if (!server.agent.token) {
      return c.json({ error: 'This server has no agent yet: provision it first' }, 409);
    }

    try {
      const database = await provisionDatabase(organizationId, server, body);

      return c.json({ database: serializeDatabase(database) }, 201);
    } catch (error) {
      return failed(c, error);
    }
  },
);

get(
  '/stats',
  databasesDocs.stats,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;

    return c.json(await fetchOrganizationDatabaseStats(organizationId));
  },
);

get(
  '/versions',
  databasesDocs.versions,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    return c.json({ versions: await fetchAllEngineVersions() });
  },
);

get(
  '/:databaseId',
  databasesDocs.get,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

    const database = await findDatabase(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (server?.agent.token) {
      await refreshDatabaseStatus(database, server).catch(() => undefined);
    }

    return c.json({
      database: serializeDatabase((await findDatabase(organizationId, databaseId))!, server),
    });
  },
);

get(
  '/:databaseId/stats',
  databasesDocs.databaseStats,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

    const database = await findDatabaseWithSecrets(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    return c.json(await fetchDatabaseStats(database, server));
  },
);

get(
  '/:databaseId/consumers',
  databasesDocs.consumers,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

    const database = await findDatabaseWithSecrets(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (!server) {
      return c.json({ error: 'Server not found' }, 404);
    }

    return c.json(await findDatabaseConsumers(database, server));
  },
);

get(
  '/:databaseId/credentials',
  databasesDocs.credentials,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

    const database = await findDatabaseWithSecrets(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    const credentials = await readCredentials(database);
    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    return c.json({
      credentials: {
        ...credentials,
        publicConnectionUri: publicConnectionUriOf(database, server, credentials),
      },
    });
  },
);

patch(
  '/:databaseId/access',
  databasesDocs.updateAccess,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('json', updateDatabaseAccessSchema),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;
    const body = c.req.valid('json' as never) as UpdateDatabaseAccessDTO;

    const database = await findDatabaseWithSecrets(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    if (database.source !== 'managed') {
      return c.json({ error: 'Only managed databases support external access' }, 400);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (!server?.agent.token) {
      return c.json({ error: 'This server has no agent yet' }, 409);
    }

    if (body.enabled) {
      const conflict = await findDatabaseAccessConflict(database, body.hostPort!);

      if (conflict) {
        return c.json(
          { error: `Host port ${conflict.port} is already in use by ${conflict.owner}` },
          400,
        );
      }
    }

    try {
      const updated = await applyDatabaseAccess(database, server, body);

      return c.json({ database: serializeDatabase(updated, server) });
    } catch (error) {
      return failed(c, error);
    }
  },
);

const lifecycleRoute = (
  action: 'start' | 'stop' | 'restart',
  doc: (typeof databasesDocs)['start'],
) =>
  post(
    `/:databaseId/${action}`,
    doc,
    authMiddleware,
    validator('param', databaseIdParamSchema),
    createOrganizationRoleGuard('admin'),
    blockOnStandby,
    async (c: Context) => {
      const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

      const database = await findDatabase(organizationId, databaseId);

      if (!database) {
        return c.json({ error: 'Database not found' }, 404);
      }

      const server = await findServerWithAgentToken(organizationId, String(database.serverId));

      if (!server?.agent.token) {
        return c.json({ error: 'This server has no agent yet' }, 409);
      }

      try {
        return c.json({ status: await runLifecycle(database, server, action) });
      } catch (error) {
        return failed(c, error);
      }
    },
  );

lifecycleRoute('start', databasesDocs.start);
lifecycleRoute('stop', databasesDocs.stop);
lifecycleRoute('restart', databasesDocs.restart);

post(
  '/:databaseId/reconcile',
  databasesDocs.reconcile,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;

    const database = await findDatabaseWithSecrets(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    if (database.source !== 'managed') {
      return c.json({ error: 'Only managed databases support reconciliation' }, 400);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (!server?.agent.token) {
      return c.json({ error: 'This server has no agent yet' }, 409);
    }

    try {
      return c.json(await ensureDatabaseContainer(database, server));
    } catch (error) {
      return failed(c, error);
    }
  },
);

del(
  '/:databaseId',
  databasesDocs.remove,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('query', removeDatabaseQuerySchema),
  async (c: Context) => {
    const { organizationId, databaseId } = c.req.valid('param' as never) as DatabaseIdParam;
    const { removeData } = c.req.valid('query' as never) as RemoveDatabaseQuery;

    const database = await findDatabase(organizationId, databaseId);

    if (!database) {
      return c.json({ error: 'Database not found' }, 404);
    }

    const server = await findServerWithAgentToken(organizationId, String(database.serverId));

    if (!server?.agent.token) {
      return c.json({ error: 'This server has no agent yet' }, 409);
    }

    try {
      await destroyDatabase(database, server, Boolean(removeData));

      return c.json({ message: 'Database destroyed successfully' });
    } catch (error) {
      return failed(c, error);
    }
  },
);

export default router;
