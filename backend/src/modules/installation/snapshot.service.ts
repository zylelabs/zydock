import { Types } from 'mongoose';
import config from '../../config';
import { volumeNameOf } from '../../providers/database/container.provider';
import { resolveSnapshotProvider } from '../../providers/snapshot';
import { resolveStorageProvider } from '../../providers/storage';
import { errorMessage } from '../../utils';
import { storeArchive } from '../../utils/archive';
import { logError, logInfo } from '../../utils/logger';
import { encryptSnapshotStream } from '../../utils/snapshot-crypto';
import { listApplicationsOfServer } from '../applications/application.service';
import { listDatabasesOfServer } from '../databases/database.service';
import { getDashboardDocument } from '../dashboard/dashboard.service';
import { getLocalServerId } from '../servers/local-server.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { markSnapshotTaken } from './installation.service';
import snapshotModel from './snapshot.model';
import type { CreateSnapshotDTO } from './snapshot.schema';

const storage = () => resolveStorageProvider();

const keyOf = (id: string) => `installation/${id}.zsnap`;

const localAgentServer = async () => {
  const serverId = getLocalServerId();

  if (!serverId) {
    throw new Error(
      'The local server is not registered, so this installation cannot be snapshotted',
    );
  }

  const server = await findServerById(serverId);

  if (!server?.agent.token) {
    throw new Error('The local server has no agent yet');
  }

  return server;
};

const applicationDataVolumesOf = async (serverId: string) => {
  const [applications, databases] = await Promise.all([
    listApplicationsOfServer(serverId),
    listDatabasesOfServer(serverId),
  ]);

  const names = new Set<string>();

  for (const application of applications) {
    for (const volume of application.volumes) {
      names.add(volume.source);
    }
  }

  for (const database of databases) {
    names.add(volumeNameOf(database.slug));
  }

  return [...names];
};

export const findSnapshot = (snapshotId: string) => snapshotModel.findById(snapshotId);

export const listSnapshots = () => snapshotModel.find().sort({ createdAt: -1 });

const runSnapshot = async (snapshotId: string, payload: CreateSnapshotDTO) => {
  const startedAt = Date.now();

  try {
    const server = await localAgentServer();
    const dashboard = await getDashboardDocument();

    const volumes = payload.includeApplicationData
      ? await applicationDataVolumesOf(String(server._id))
      : undefined;

    const bundle = await resolveSnapshotProvider(buildAgentConnection(server)).streamBundle({
      publicIp: server.publicIp ?? '',
      domain: dashboard.domain,
      includeApplicationData: payload.includeApplicationData,
      volumes,
    });

    const encrypted = encryptSnapshotStream(payload.passphrase, bundle);
    const sizeBytes = await storeArchive(storage(), keyOf(snapshotId), encrypted);
    const finishedAt = new Date();

    await snapshotModel.updateOne(
      { _id: snapshotId },
      { $set: { status: 'completed', sizeBytes, finishedAt, durationMs: Date.now() - startedAt } },
    );

    await markSnapshotTaken(finishedAt);

    logInfo('Installation snapshot completed', { snapshot: snapshotId, sizeBytes });
  } catch (error) {
    await storage()
      .delete(keyOf(snapshotId))
      .catch(() => undefined);

    await snapshotModel.updateOne(
      { _id: snapshotId },
      {
        $set: {
          status: 'failed',
          error: errorMessage(error),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      },
    );

    logError('Installation snapshot failed', error, { snapshot: snapshotId });
  }
};

export const createSnapshot = async (payload: CreateSnapshotDTO, createdBy?: string) => {
  await localAgentServer();

  const id = String(new Types.ObjectId());

  const snapshot = await snapshotModel.create({
    _id: id,
    storageKey: keyOf(id),
    status: 'running',
    origin: 'generated',
    includesApplicationData: Boolean(payload.includeApplicationData),
    version: config.version,
    commit: config.commit,
    createdBy,
  });

  runSnapshot(id, payload).catch(error =>
    logError('Installation snapshot run crashed unexpectedly', error, { snapshot: id }),
  );

  return snapshotModel.findById(id);
};

export const uploadSnapshot = async (
  body: ReadableStream<Uint8Array>,
  originalFileName?: string,
  createdBy?: string,
) => {
  const id = String(new Types.ObjectId());
  const key = keyOf(id);
  const startedAt = Date.now();

  try {
    const sizeBytes = await storeArchive(storage(), key, body);
    const finishedAt = new Date();

    const snapshot = await snapshotModel.create({
      _id: id,
      storageKey: key,
      status: 'completed',
      origin: 'uploaded',
      originalFileName,
      includesApplicationData: false,
      sizeBytes,
      finishedAt,
      durationMs: Date.now() - startedAt,
      createdBy,
    });

    await markSnapshotTaken(finishedAt);

    logInfo('Installation snapshot uploaded', { snapshot: id, sizeBytes });

    return snapshot;
  } catch (error) {
    await storage()
      .delete(key)
      .catch(() => undefined);

    throw error;
  }
};

export const downloadSnapshot = (snapshot: InstallationSnapshot) =>
  storage().get(snapshot.storageKey);

export const removeSnapshot = async (snapshot: InstallationSnapshot) => {
  await storage()
    .delete(snapshot.storageKey)
    .catch(error =>
      logError('Failed to remove a snapshot archive', error, { snapshot: String(snapshot._id) }),
    );

  await snapshotModel.deleteOne({ _id: snapshot._id });
};

export const serializeSnapshot = (snapshot: InstallationSnapshot) => ({
  id: String(snapshot._id),
  status: snapshot.status,
  origin: snapshot.origin,
  originalFileName: snapshot.originalFileName,
  includesApplicationData: snapshot.includesApplicationData,
  version: snapshot.version,
  commit: snapshot.commit,
  sizeBytes: snapshot.sizeBytes,
  error: snapshot.error,
  finishedAt: snapshot.finishedAt,
  durationMs: snapshot.durationMs,
  fileName: `${String(snapshot._id)}.zsnap`,
  createdAt: snapshot.createdAt,
});
