import { Types } from 'mongoose';
import type { DatabaseStats } from '../../providers/database';
import config from '../../config';
import { logError, logWarn } from '../../utils/logger';
import { cancelPendingJobs, enqueueJob, registerJobHandler } from '../queue/queue.service';
import { findServerById } from '../servers/server.service';
import databaseSampleModel from './database-sample.model';
import { listRunningManagedDatabasesWithSecrets, measureDatabase } from './database.service';

export const DATABASE_SAMPLE_JOB = 'database.stats.sample';

export const peakConnectionsOf = async (
  databaseIds: string[],
  windowHours: number,
): Promise<Map<string, number>> => {
  if (databaseIds.length === 0) {
    return new Map();
  }

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await databaseSampleModel.aggregate([
    {
      $match: {
        databaseId: { $in: databaseIds.map(id => new Types.ObjectId(id)) },
        capturedAt: { $gte: since },
        connections: { $ne: null },
      },
    },
    { $group: { _id: '$databaseId', peakConnections: { $max: '$connections' } } },
  ]);

  return new Map(results.map(result => [String(result._id), result.peakConnections as number]));
};

export const recordDatabaseSample = async (databaseId: string, stats: DatabaseStats) => {
  if (typeof stats.connections !== 'number') {
    return;
  }

  await databaseSampleModel
    .create({
      databaseId,
      capturedAt: new Date(),
      connections: stats.connections,
      maxConnections: stats.maxConnections,
      sizeBytes: stats.sizeBytes,
    })
    .catch(error =>
      logError('Failed to record a database sample', error, { database: databaseId }),
    );
};

const sampleDatabasesOfServer = async (server: Server, databases: ManagedDatabase[]) => {
  for (const database of databases) {
    try {
      const stats = await measureDatabase(database, server);

      await recordDatabaseSample(String(database._id), stats);
    } catch (error) {
      logError('Failed to sample a database', error, { database: String(database._id) });
    }
  }
};

const groupByServer = (databases: ManagedDatabase[]) => {
  const byServer = new Map<string, ManagedDatabase[]>();

  for (const database of databases) {
    const serverId = String(database.serverId);

    byServer.set(serverId, [...(byServer.get(serverId) ?? []), database]);
  }

  return byServer;
};

export const runDatabaseSampling = async () => {
  const databases = await listRunningManagedDatabasesWithSecrets();

  for (const [serverId, serverDatabases] of groupByServer(databases)) {
    const server = await findServerById(serverId);

    if (!server?.agent.token) {
      logWarn('Skipped database sampling: server has no agent', { server: serverId });
      continue;
    }

    await sampleDatabasesOfServer(server, serverDatabases);
  }
};

export const scheduleDatabaseSampling = async () => {
  await cancelPendingJobs(DATABASE_SAMPLE_JOB);

  if (!config.databaseMetrics.enabled) {
    return;
  }

  const runAt = new Date(Date.now() + config.databaseMetrics.sampleIntervalMinutes * 60 * 1000);

  await enqueueJob(DATABASE_SAMPLE_JOB, {}, { maxAttempts: 1, runAt });
};

registerJobHandler(DATABASE_SAMPLE_JOB, async () => {
  try {
    await runDatabaseSampling();
  } finally {
    await scheduleDatabaseSampling();
  }
});

export const bootstrapDatabaseMetrics = async () => {
  try {
    await scheduleDatabaseSampling();
  } catch (error) {
    logWarn('The database metrics sampler could not be bootstrapped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
