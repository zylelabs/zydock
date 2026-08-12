import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerWithAgentToken } from '../servers/server.service';
import databaseModel from './database.model';
import {
  CreateDatabaseDTO,
  createDatabaseSchema,
  DatabaseIdParam,
  databaseIdParamSchema,
  ListDatabasesQuery,
  listDatabasesQuerySchema,
  RemoveDatabaseQuery,
  removeDatabaseQuerySchema,
} from './database.schema';
import {
  destroyDatabase,
  findDatabase,
  findDatabaseWithSecrets,
  provisionDatabase,
  readCredentials,
  refreshDatabaseStatus,
  runLifecycle,
  serializeDatabase,
} from './database.service';
import { databasesDocs } from './databases.docs';

const { router, get, post, delete: del } = createRouter();

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

    return c.json({ ...result, items: result.items.map(serializeDatabase) });
  },
);

post(
  '/',
  databasesDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
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
      database: serializeDatabase((await findDatabase(organizationId, databaseId))!),
    });
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

    return c.json({ credentials: await readCredentials(database) });
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

del(
  '/:databaseId',
  databasesDocs.remove,
  authMiddleware,
  validator('param', databaseIdParamSchema),
  createOrganizationRoleGuard('admin'),
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
