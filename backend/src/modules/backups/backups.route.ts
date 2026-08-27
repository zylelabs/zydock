import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { findDatabase } from '../databases/database.service';
import { blockOnStandby } from '../installation/installation.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import { findServerWithAgentToken } from '../servers/server.service';
import backupModel from './backup.model';
import {
  BackupIdParam,
  backupIdParamSchema,
  CreateBackupDTO,
  createBackupSchema,
  ListBackupsQuery,
  listBackupsQuerySchema,
} from './backup.schema';
import {
  downloadBackup,
  fileNameOf,
  findBackup,
  removeBackup,
  startRestore,
  serializeBackup,
  startBackup,
} from './backup.service';
import { backupsDocs } from './backups.docs';

const { router, get, post, delete: del } = createRouter();

get(
  '/',
  backupsDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listBackupsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { type, status, databaseId, serverId } = c.req.valid(
      'query' as never,
    ) as ListBackupsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await backupModel.paginate(
      {
        organizationId,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(databaseId ? { databaseId } : {}),
        ...(serverId ? { serverId } : {}),
      },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeBackup) });
  },
);

post(
  '/',
  backupsDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createBackupSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateBackupDTO;
    const auth = c.get('auth');

    if (body.type === 'database') {
      const database = await findDatabase(organizationId, body.databaseId);

      if (!database) {
        return c.json({ error: 'Database not found in this organization' }, 400);
      }

      const backup = await startBackup({ organizationId, body, database, createdBy: auth.sub });

      return c.json({ backup: serializeBackup(backup) }, 202);
    }

    if (body.type === 'volume') {
      const server = await findServerWithAgentToken(organizationId, body.serverId);

      if (!server) {
        return c.json({ error: 'Server not found in this organization' }, 400);
      }

      if (!server.agent.token) {
        return c.json({ error: 'This server has no agent yet' }, 409);
      }
    }

    const backup = await startBackup({ organizationId, body, createdBy: auth.sub });

    return c.json({ backup: serializeBackup(backup) }, 202);
  },
);

get(
  '/:backupId',
  backupsDocs.get,
  authMiddleware,
  validator('param', backupIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, backupId } = c.req.valid('param' as never) as BackupIdParam;

    const backup = await findBackup(organizationId, backupId);

    if (!backup) {
      return c.json({ error: 'Backup not found' }, 404);
    }

    return c.json({ backup: serializeBackup(backup) });
  },
);

get(
  '/:backupId/download',
  backupsDocs.download,
  authMiddleware,
  validator('param', backupIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, backupId } = c.req.valid('param' as never) as BackupIdParam;

    const backup = await findBackup(organizationId, backupId);

    if (!backup) {
      return c.json({ error: 'Backup not found' }, 404);
    }

    if (backup.status !== 'completed') {
      return c.json({ error: 'This backup has not completed' }, 409);
    }

    try {
      return new Response(await downloadBackup(backup), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileNameOf(backup)}"`,
        },
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  },
);

post(
  '/:backupId/restore',
  backupsDocs.restore,
  authMiddleware,
  validator('param', backupIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  async (c: Context) => {
    const { organizationId, backupId } = c.req.valid('param' as never) as BackupIdParam;

    const backup = await findBackup(organizationId, backupId);

    if (!backup) {
      return c.json({ error: 'Backup not found' }, 404);
    }

    if (backup.type === 'configuration') {
      return c.json({ error: 'A configuration export cannot be restored' }, 400);
    }

    if (backup.status !== 'completed') {
      return c.json({ error: 'This backup has not completed' }, 409);
    }

    if (backup.restoreStatus === 'running') {
      return c.json({ error: 'A restore of this backup is already running' }, 409);
    }

    const restoring = await startRestore(backup);

    return c.json({ backup: serializeBackup(restoring!) }, 202);
  },
);

del(
  '/:backupId',
  backupsDocs.remove,
  authMiddleware,
  validator('param', backupIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, backupId } = c.req.valid('param' as never) as BackupIdParam;

    const backup = await findBackup(organizationId, backupId);

    if (!backup) {
      return c.json({ error: 'Backup not found' }, 404);
    }

    await removeBackup(backup);

    return c.json({ message: 'Backup removed successfully' });
  },
);

export default router;
