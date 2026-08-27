import { stopBackgroundWork } from '../../app-server';
import { logError, logInfo } from '../../utils/logger';
import { ensureDatabaseContainer, listDatabasesOfServer } from '../databases/database.service';
import { ensureDashboardRoutes } from '../dashboard/dashboard-route.service';
import { getDashboardDocument, resolveDnsMismatch } from '../dashboard/dashboard.service';
import domainModel from '../domains/domain.model';
import { startWorker } from '../queue/queue.service';
import { forceLocalServerPublicIp, getLocalServerId } from '../servers/local-server.service';
import { reprovisionRemoteServers } from '../servers/provisioning.service';
import { findServerById } from '../servers/server.service';
import installationModel from './installation.model';
import type { InstallationRole, RoleChangeDTO } from './installation.schema';

const DEFAULT_INSTALLATION = { role: 'active' as InstallationRole };

const ORIGIN_CHECK_TIMEOUT_MS = 5000;

let cachedRole: InstallationRole | undefined;

export const invalidateInstallationCache = () => {
  cachedRole = undefined;
};

export const getInstallation = async () => {
  const document = await installationModel.findOneAndUpdate(
    {},
    { $setOnInsert: DEFAULT_INSTALLATION },
    { upsert: true, new: true },
  );

  cachedRole = document!.role;

  return document!;
};

export const getInstallationRole = async () => {
  if (!cachedRole) {
    await getInstallation();
  }

  return cachedRole!;
};

export const isStandby = async () => (await getInstallationRole()) === 'standby';

export const setRole = async (role: InstallationRole, note?: string) => {
  const current = await getInstallation();
  const now = new Date();

  await installationModel.updateOne(
    { _id: current._id },
    {
      $set: {
        role,
        ...(role === 'standby'
          ? { demotedAt: now, standbySince: current.standbySince ?? now }
          : { promotedAt: now }),
        ...(note === undefined ? {} : { note }),
      },
      ...(role === 'active' ? { $unset: { standbySince: '' } } : {}),
    },
  );

  invalidateInstallationCache();

  if (role === 'standby') {
    stopBackgroundWork();
  } else {
    await startWorker();

    ensureDashboardRoutes().catch(error => {
      logError('Failed to ensure the dashboard routes', error);
    });
  }

  logInfo('Installation role changed', { from: current.role, to: role });

  return getInstallation();
};

export const markSnapshotTaken = async (at: Date) => {
  await installationModel.updateOne({}, { $set: { lastSnapshotAt: at } }, { upsert: true });
};

export const setLastRestoreRunId = async (runId: string) => {
  await installationModel.updateOne({}, { $set: { lastRestoreRunId: runId } }, { upsert: true });
};

export const serializeInstallation = (document: Installation) => ({
  role: document.role,
  standbySince: document.standbySince,
  promotedAt: document.promotedAt,
  demotedAt: document.demotedAt,
  dataFrom: document.dataFrom,
  replicaOf: document.replicaOf
    ? {
        host: document.replicaOf.host ?? '',
        publicIp: document.replicaOf.publicIp ?? '',
        version: document.replicaOf.version ?? '',
        snapshotAt: document.replicaOf.snapshotAt,
      }
    : undefined,
  lastSnapshotAt: document.lastSnapshotAt,
  note: document.note ?? '',
});

const originBaseUrl = (origin: InstallationReplicaSource) => {
  if (origin.host) {
    return `https://${origin.host}`;
  }

  if (origin.publicIp) {
    return `http://${origin.publicIp}`;
  }

  return undefined;
};

const verifyOriginDemoted = async (installation: Installation, force: boolean) => {
  const baseUrl = installation.replicaOf && originBaseUrl(installation.replicaOf);

  if (!baseUrl || force) {
    return;
  }

  let role: string | undefined;

  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(ORIGIN_CHECK_TIMEOUT_MS),
    });

    if (response.ok) {
      role = ((await response.json()) as { role?: string }).role;
    }
  } catch {
    role = undefined;
  }

  if (role === undefined) {
    throw new Error(
      'The origin installation did not respond. Confirm it is stopped, then retry with force: true.',
    );
  }

  if (role !== 'standby') {
    throw new Error(
      'The origin installation is still active. Demote it before promoting this one, or retry with force: true.',
    );
  }
};

const reconcileLocalDatabases = async () => {
  const serverId = getLocalServerId();

  if (!serverId) {
    return;
  }

  const server = await findServerById(serverId);

  if (!server) {
    return;
  }

  const databases = await listDatabasesOfServer(serverId);

  for (const database of databases) {
    if (database.source !== 'managed') {
      continue;
    }

    try {
      await ensureDatabaseContainer(database, server);
    } catch (error) {
      logError('Failed to reconcile a database during promotion', error, {
        database: database.slug,
      });
    }
  }
};

export const demote = async (payload: RoleChangeDTO = {}) => setRole('standby', payload.note);

export const promote = async (payload: RoleChangeDTO = {}) => {
  const installation = await getInstallation();

  await verifyOriginDemoted(installation, Boolean(payload.force));

  const promoted = await setRole('active', payload.note);

  await forceLocalServerPublicIp();
  await reconcileLocalDatabases();

  await reprovisionRemoteServers().catch(error => {
    logError('Failed to enqueue the reprovisioning of the remote servers after promotion', error);
  });

  return promoted;
};

export const dnsChecklist = async () => {
  const dashboard = await getDashboardDocument();
  const serverId = getLocalServerId();

  const domains = serverId ? await domainModel.find({ serverId }) : [];

  const entries = [
    ...(dashboard.domain ? [{ kind: 'dashboard' as const, domain: dashboard.domain }] : []),
    ...domains.map(domain => ({ kind: 'application' as const, domain: domain.hostname })),
  ];

  return Promise.all(
    entries.map(async entry => ({
      ...entry,
      pointsToOldIp: await resolveDnsMismatch(entry.domain),
    })),
  );
};
