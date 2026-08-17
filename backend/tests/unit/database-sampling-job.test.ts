import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { encryptSecret } from '../../src/utils/crypto';
import jobModel from '../../src/modules/queue/job.model';
import databaseModel from '../../src/modules/databases/database.model';
import databaseSampleModel from '../../src/modules/databases/database-sample.model';
import serverModel from '../../src/modules/servers/server.model';
import {
  DATABASE_SAMPLE_JOB,
  runDatabaseSampling,
  scheduleDatabaseSampling,
} from '../../src/modules/databases/database-sample.service';

const organizationId = new mongoose.Types.ObjectId();

const originalFetch = globalThis.fetch;

const statsStdout = ['connections=9', 'maxConnections=100'].join('\n');

const installAgentMock = (containerId: string) => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;

    if (path === `/api/containers/${containerId}/exec`) {
      return new Response(JSON.stringify({ exitCode: 0, stdout: statsStdout, stderr: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === `/api/containers/${containerId}`) {
      return new Response(
        JSON.stringify({
          id: containerId,
          name: containerId,
          image: 'postgres:16',
          state: 'running',
          health: 'none',
          restartCount: 0,
          ports: [],
          labels: {},
          protected: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    throw new Error(`Unhandled agent request in test mock: ${path}`);
  }) as typeof fetch;
};

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

beforeAll(async () => {
  await connectDatabase();
});

afterEach(async () => {
  restoreFetch();
  await databaseModel.deleteMany({ organizationId });
  await serverModel.deleteMany({ organizationId });
  await databaseSampleModel.deleteMany({});
  await jobModel.deleteMany({ type: DATABASE_SAMPLE_JOB });
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('runDatabaseSampling', () => {
  test('records one sample per eligible database, skipping a server without an agent', async () => {
    const containerId = `sampling-container-${Date.now()}`;

    const serverWithAgent = await serverModel.create({
      organizationId,
      name: 'server-with-agent',
      type: 'ssh',
      agent: { host: '127.0.0.1', port: 9000, token: encryptSecret('agent-token') },
    });

    const serverWithoutAgent = await serverModel.create({
      organizationId,
      name: 'server-without-agent',
      type: 'ssh',
    });

    const sampledDatabase = await databaseModel.create({
      organizationId,
      serverId: serverWithAgent._id,
      name: 'sampled-db',
      slug: 'sampled-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId,
      credentials: {
        host: containerId,
        port: 5432,
        username: 'zydock',
        database: 'sampled',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(`postgresql://zydock:secret@${containerId}:5432/sampled`),
      },
    });

    const skippedDatabase = await databaseModel.create({
      organizationId,
      serverId: serverWithoutAgent._id,
      name: 'no-agent-db',
      slug: 'no-agent-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: `no-agent-container-${Date.now()}`,
      credentials: {
        host: 'no-agent-host',
        port: 5432,
        username: 'zydock',
        database: 'no_agent',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret('postgresql://zydock:secret@no-agent-host:5432/no_agent'),
      },
    });

    installAgentMock(containerId);

    await expect(runDatabaseSampling()).resolves.toBeUndefined();

    const samples = await databaseSampleModel.find({}).sort({ capturedAt: 1 });

    expect(samples).toHaveLength(1);
    expect(String(samples[0]!.databaseId)).toBe(String(sampledDatabase._id));
    expect(samples[0]!.connections).toBe(9);

    const skippedSamples = await databaseSampleModel.find({ databaseId: skippedDatabase._id });

    expect(skippedSamples).toHaveLength(0);
  });

  test('a failure measuring one database does not stop the others from being sampled', async () => {
    const workingContainerId = `sampling-ok-${Date.now()}`;
    const failingContainerId = `sampling-fail-${Date.now()}`;

    const server = await serverModel.create({
      organizationId,
      name: 'server-mixed',
      type: 'ssh',
      agent: { host: '127.0.0.1', port: 9000, token: encryptSecret('agent-token') },
    });

    const workingDatabase = await databaseModel.create({
      organizationId,
      serverId: server._id,
      name: 'working-db',
      slug: 'working-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: workingContainerId,
      credentials: {
        host: workingContainerId,
        port: 5432,
        username: 'zydock',
        database: 'working',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          `postgresql://zydock:secret@${workingContainerId}:5432/working`,
        ),
      },
    });

    await databaseModel.create({
      organizationId,
      serverId: server._id,
      name: 'failing-db',
      slug: 'failing-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: failingContainerId,
      credentials: {
        host: failingContainerId,
        port: 5432,
        username: 'zydock',
        database: 'failing',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          `postgresql://zydock:secret@${failingContainerId}:5432/failing`,
        ),
      },
    });

    installAgentMock(workingContainerId);

    await expect(runDatabaseSampling()).resolves.toBeUndefined();

    const samples = await databaseSampleModel.find({ databaseId: workingDatabase._id });

    expect(samples).toHaveLength(1);
  });
});

describe('scheduleDatabaseSampling', () => {
  test('cancels pending jobs before enqueuing the next one', async () => {
    await jobModel.create({
      type: DATABASE_SAMPLE_JOB,
      payload: {},
      status: 'pending',
      runAt: new Date(Date.now() + 60_000),
    });

    await scheduleDatabaseSampling();

    const pending = await jobModel.find({ type: DATABASE_SAMPLE_JOB, status: 'pending' });

    expect(pending).toHaveLength(1);
  });
});
