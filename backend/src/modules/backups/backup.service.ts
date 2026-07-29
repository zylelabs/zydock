import { ObjectId } from 'bson';
import { resolveContainerProvider } from '../../providers/container';
import { resolveStorageProvider } from '../../providers/storage';
import { errorMessage } from '../../utils';
import { storeArchive } from '../../utils/archive';
import { logError, logInfo } from '../../utils/logger';
import {
  listApplicationsOfOrganization,
  serializeApplication,
} from '../applications/application.service';
import {
  backupDatabase,
  dumpExtensionOf,
  findDatabaseWithSecrets,
  listDatabasesOfOrganization,
  restoreDatabase,
  serializeDatabase,
} from '../databases/database.service';
import { listDomainsOfOrganization, serializeDomain } from '../domains/domain.service';
import {
  listNotificationChannelsOfOrganization,
  serializeNotificationChannel,
} from '../notifications/notification.service';
import { findOrganizationById, serializeOrganization } from '../organizations/organization.service';
import { listEnvironmentsOfProjects, serializeEnvironment } from '../projects/environment.service';
import { listProjectsOfOrganization, serializeProject } from '../projects/project.service';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import {
  buildAgentConnection,
  findServerById,
  listServersOfOrganization,
  serializeServer,
} from '../servers/server.service';
import backupModel from './backup.model';
import type { BackupType, CreateBackupDTO } from './backup.schema';

export const BACKUP_JOB = 'backup.run';
export const RESTORE_JOB = 'backup.restore';

const CONFIGURATION_VERSION = 1;

const storage = () => resolveStorageProvider();

const keyOf = (organizationId: string, type: BackupType, id: string, extension: string) =>
  `backups/${organizationId}/${type}/${id}.${extension}`;

export const findBackup = (organizationId: string, backupId: string) =>
  backupModel.findOne({ _id: backupId, organizationId });

export const fileNameOf = (backup: Backup) =>
  backup.storageKey.split('/').pop() ?? backup.storageKey;

const exportConfiguration = async (organizationId: string) => {
  const organization = await findOrganizationById(organizationId);
  const projects = await listProjectsOfOrganization(organizationId);
  const environments = await listEnvironmentsOfProjects(
    projects.map(project => String(project._id)),
  );
  const applications = await listApplicationsOfOrganization(organizationId);
  const servers = await listServersOfOrganization(organizationId);
  const domains = await listDomainsOfOrganization(organizationId);
  const databases = await listDatabasesOfOrganization(organizationId);
  const channels = await listNotificationChannelsOfOrganization(organizationId);

  return {
    version: CONFIGURATION_VERSION,
    exportedAt: new Date().toISOString(),
    organization: organization ? serializeOrganization(organization) : null,
    servers: servers.map(serializeServer),
    projects: projects.map(serializeProject),
    environments: environments.map(serializeEnvironment),
    applications: applications.map(serializeApplication),
    domains: domains.map(serializeDomain),
    databases: databases.map(serializeDatabase),
    notificationChannels: channels.map(serializeNotificationChannel),
  };
};

type BackupTarget = {
  label: string;
  extension: string;
  serverId?: string;
  databaseId?: string;
  applicationId?: string;
  volumeName?: string;
  engine?: string;
};

const targetOf = (body: CreateBackupDTO, context: { database?: ManagedDatabase }): BackupTarget => {
  if (body.type === 'database') {
    const database = context.database!;

    return {
      label: database.name,
      extension: dumpExtensionOf(database.engine),
      serverId: String(database.serverId),
      databaseId: String(database._id),
      engine: database.engine,
    };
  }

  if (body.type === 'volume') {
    return {
      label: body.volumeName,
      extension: 'tar.gz',
      serverId: body.serverId,
      volumeName: body.volumeName,
      applicationId: body.applicationId,
    };
  }

  return { label: 'configuration', extension: 'json' };
};

export const startBackup = async (params: {
  organizationId: string;
  body: CreateBackupDTO;
  database?: ManagedDatabase;
  createdBy?: string;
}) => {
  const id = new ObjectId();
  const target = targetOf(params.body, { database: params.database });

  const backup = await backupModel.create({
    _id: id,
    organizationId: params.organizationId,
    type: params.body.type,
    status: 'running',
    storageKey: keyOf(params.organizationId, params.body.type, String(id), target.extension),
    label: target.label,
    serverId: target.serverId,
    databaseId: target.databaseId,
    applicationId: target.applicationId,
    volumeName: target.volumeName,
    engine: target.engine,
    createdBy: params.createdBy,
  });

  await enqueueJob(BACKUP_JOB, { backupId: String(backup._id) }, { maxAttempts: 1 });

  return backup;
};

const serverOf = async (backup: Backup) => {
  const server = await findServerById(String(backup.serverId));

  if (!server?.agent.token) {
    throw new Error('The server of this backup has no agent');
  }

  return server;
};

const produce = async (backup: Backup) => {
  if (backup.type === 'configuration') {
    const payload = await exportConfiguration(String(backup.organizationId));
    const data = new TextEncoder().encode(JSON.stringify(payload, null, 2));

    await storage().put(backup.storageKey, data, { contentType: 'application/json' });

    return data.byteLength;
  }

  const server = await serverOf(backup);

  if (backup.type === 'database') {
    const database = await findDatabaseWithSecrets(
      String(backup.organizationId),
      String(backup.databaseId),
    );

    if (!database) {
      throw new Error('The database of this backup no longer exists');
    }

    const { sizeBytes } = await backupDatabase(database, server, backup.storageKey);

    return sizeBytes;
  }

  const containers = resolveContainerProvider(buildAgentConnection(server));

  return storeArchive(
    storage(),
    backup.storageKey,
    await containers.archiveVolume(String(backup.volumeName)),
  );
};

export const runBackup = async (backupId: string) => {
  const backup = await backupModel.findById(backupId);

  if (!backup || backup.status !== 'running') {
    return;
  }

  const startedAt = Date.now();

  try {
    const sizeBytes = await produce(backup);

    await backupModel.updateOne(
      { _id: backup._id },
      {
        $set: {
          status: 'completed',
          sizeBytes,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      },
    );

    logInfo('Backup completed', { backup: backupId, type: backup.type, sizeBytes });
  } catch (error) {
    await storage()
      .delete(backup.storageKey)
      .catch(cleanupError =>
        logError('Failed to remove the archive of a failed backup', cleanupError, {
          backup: backupId,
        }),
      );

    await backupModel.updateOne(
      { _id: backup._id },
      {
        $set: {
          status: 'failed',
          error: errorMessage(error),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      },
    );

    logError('Backup failed', error, { backup: backupId, type: backup.type });
  }
};

registerJobHandler(BACKUP_JOB, async payload => {
  await runBackup(String(payload.backupId));
});

export const startRestore = async (backup: Backup) => {
  await backupModel.updateOne(
    { _id: backup._id },
    { $set: { restoreStatus: 'running' }, $unset: { restoreError: '' } },
  );

  await enqueueJob(RESTORE_JOB, { backupId: String(backup._id) }, { maxAttempts: 1 });

  return backupModel.findById(backup._id);
};

const applyRestore = async (backup: Backup) => {
  if (!(await storage().exists(backup.storageKey))) {
    throw new Error('The archive of this backup is no longer in storage');
  }

  const server = await serverOf(backup);

  if (backup.type === 'database') {
    const database = await findDatabaseWithSecrets(
      String(backup.organizationId),
      String(backup.databaseId),
    );

    if (!database) {
      throw new Error('The database of this backup no longer exists');
    }

    await restoreDatabase(database, server, backup.storageKey);
  } else {
    const containers = resolveContainerProvider(buildAgentConnection(server));

    await containers.restoreVolume(
      String(backup.volumeName),
      await storage().get(backup.storageKey),
    );
  }
};

export const runRestore = async (backupId: string) => {
  const backup = await backupModel.findById(backupId);

  if (!backup || backup.restoreStatus !== 'running') {
    return;
  }

  try {
    await applyRestore(backup);

    await backupModel.updateOne(
      { _id: backup._id },
      { $set: { restoreStatus: 'completed', lastRestoredAt: new Date() } },
    );

    logInfo('Backup restored', { backup: backupId, type: backup.type });
  } catch (error) {
    await backupModel.updateOne(
      { _id: backup._id },
      { $set: { restoreStatus: 'failed', restoreError: errorMessage(error) } },
    );

    logError('Restore failed', error, { backup: backupId, type: backup.type });
  }
};

registerJobHandler(RESTORE_JOB, async payload => {
  await runRestore(String(payload.backupId));
});

export const downloadBackup = (backup: Backup) => storage().get(backup.storageKey);

export const removeBackup = async (backup: Backup) => {
  await storage()
    .delete(backup.storageKey)
    .catch(error =>
      logError('Failed to remove the archive of a backup', error, { backup: String(backup._id) }),
    );

  await backupModel.deleteOne({ _id: backup._id });
};

export const removeBackupsOfOrganization = async (organizationId: string) => {
  const backups = await backupModel.find({ organizationId });

  for (const backup of backups) {
    await removeBackup(backup);
  }
};

export const serializeBackup = (backup: Backup) => ({
  id: String(backup._id),
  organizationId: String(backup.organizationId),
  type: backup.type,
  status: backup.status,
  label: backup.label,
  serverId: backup.serverId ? String(backup.serverId) : undefined,
  databaseId: backup.databaseId ? String(backup.databaseId) : undefined,
  applicationId: backup.applicationId ? String(backup.applicationId) : undefined,
  volumeName: backup.volumeName,
  engine: backup.engine,
  fileName: fileNameOf(backup),
  sizeBytes: backup.sizeBytes,
  error: backup.error,
  finishedAt: backup.finishedAt,
  durationMs: backup.durationMs,
  restoreStatus: backup.restoreStatus,
  restoreError: backup.restoreError,
  lastRestoredAt: backup.lastRestoredAt,
  createdAt: backup.createdAt,
});
