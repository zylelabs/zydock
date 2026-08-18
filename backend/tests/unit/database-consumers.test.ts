import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { encryptSecret } from '../../src/utils/crypto';
import { APPLICATION_LABEL } from '../../src/modules/deployments/naming';
import applicationModel from '../../src/modules/applications/application.model';
import databaseModel from '../../src/modules/databases/database.model';
import { findDatabaseConsumers } from '../../src/modules/databases/database.service';
import type { ContainerInfo } from '../../src/providers/container/container.contract';

const organizationId = new mongoose.Types.ObjectId();
const projectId = new mongoose.Types.ObjectId();
const environmentId = new mongoose.Types.ObjectId();
const serverId = new mongoose.Types.ObjectId();

const server = { _id: serverId, agent: {} } as unknown as Server;

const agentServerId = new mongoose.Types.ObjectId();
const agentContainerId = 'db-consumers-container';
const agentEndpoint = { host: '127.0.0.1', port: 9321 };

const agentServer = {
  _id: agentServerId,
  agent: { token: encryptSecret('agent-token'), ...agentEndpoint },
} as unknown as Server;

const originalFetch = globalThis.fetch;

const containerInfo = (overrides: Partial<ContainerInfo>): ContainerInfo => ({
  id: overrides.id ?? 'container',
  name: overrides.name ?? 'container',
  image: overrides.image ?? 'image',
  state: overrides.state ?? 'running',
  health: overrides.health ?? 'none',
  restartCount: overrides.restartCount ?? 0,
  ports: overrides.ports ?? [],
  protected: overrides.protected ?? false,
  stdinOpen: overrides.stdinOpen ?? false,
  labels: overrides.labels ?? {},
  addresses: overrides.addresses,
});

const installAgentMock = (clientsStdout: string, containers: ContainerInfo[]) => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;

    if (path === `/api/containers/${agentContainerId}/exec`) {
      return new Response(JSON.stringify({ exitCode: 0, stdout: clientsStdout, stderr: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/containers') {
      return new Response(JSON.stringify(containers), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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
  await applicationModel.deleteMany({ organizationId });
  await databaseModel.deleteMany({ organizationId });
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('findDatabaseConsumers', () => {
  test('a compose database returns the linked application', async () => {
    const application = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId,
      name: 'linked-app',
      slug: 'linked-app',
      source: 'compose',
    });

    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'linked-app (db)',
      slug: 'linked-app-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'compose',
      link: {
        applicationId: application._id,
        service: 'db',
        password: { key: 'DATABASE_URL', value: 'x' },
      },
    });

    const consumers = await findDatabaseConsumers(database, server);

    expect(consumers).toEqual({
      items: [
        {
          applicationId: String(application._id),
          name: 'linked-app',
          variableKey: 'DATABASE_URL',
        },
      ],
    });
  });

  test('a managed database matches by the connection host', async () => {
    const application = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId,
      name: 'consumer-by-host',
      slug: 'consumer-by-host',
      source: 'git',
      variables: [
        { key: 'DATABASE_HOST', value: encryptSecret('zydock-db-managed-1'), secret: false },
      ],
    });

    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'managed-1',
      slug: 'managed-1',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      credentials: {
        host: 'zydock-db-managed-1',
        port: 5432,
        username: 'zydock',
        database: 'managed_1',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-managed-1:5432/managed_1',
        ),
      },
    });

    const consumers = await findDatabaseConsumers(database, server);

    expect(consumers).toEqual({
      items: [
        {
          applicationId: String(application._id),
          name: 'consumer-by-host',
          variableKey: 'DATABASE_HOST',
        },
      ],
    });
  });

  test('a managed database matches by the full connection URI', async () => {
    const connectionUri = 'postgresql://zydock:secret@zydock-db-managed-2:5432/managed_2';

    const application = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId,
      name: 'consumer-by-uri',
      slug: 'consumer-by-uri',
      source: 'git',
      variables: [{ key: 'DATABASE_URL', value: encryptSecret(connectionUri), secret: true }],
    });

    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'managed-2',
      slug: 'managed-2',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      credentials: {
        host: 'zydock-db-managed-2',
        port: 5432,
        username: 'zydock',
        database: 'managed_2',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(connectionUri),
      },
    });

    const consumers = await findDatabaseConsumers(database, server);

    expect(consumers).toEqual({
      items: [
        {
          applicationId: String(application._id),
          name: 'consumer-by-uri',
          variableKey: 'DATABASE_URL',
        },
      ],
    });
    consumers.items.forEach(consumer => {
      expect(Object.keys(consumer)).not.toContain('value');
    });
  });

  test('no matching variable resolves to an empty list, never an error', async () => {
    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'managed-orphan',
      slug: 'managed-orphan',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      credentials: {
        host: 'zydock-db-orphan',
        port: 5432,
        username: 'zydock',
        database: 'orphan',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret('postgresql://zydock:secret@zydock-db-orphan:5432/orphan'),
      },
    });

    await expect(findDatabaseConsumers(database, server)).resolves.toEqual({ items: [] });
  });

  test('a compose database whose linked application was deleted resolves to an empty list', async () => {
    const database = await databaseModel.create({
      organizationId,
      serverId,
      name: 'orphan-link (db)',
      slug: 'orphan-link-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'compose',
      link: {
        applicationId: new mongoose.Types.ObjectId(),
        service: 'db',
        password: { key: 'DATABASE_URL', value: 'x' },
      },
    });

    await expect(findDatabaseConsumers(database, server)).resolves.toEqual({ items: [] });
  });
});

describe('findDatabaseConsumers connection counting via container IP', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('a container whose address matches a client ip is counted, without a variableKey', async () => {
    const application = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId: agentServerId,
      name: 'connects-without-declaring',
      slug: 'connects-without-declaring',
      source: 'git',
    });

    const database = await databaseModel.create({
      organizationId,
      serverId: agentServerId,
      name: 'ip-mapped-1',
      slug: 'ip-mapped-1',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: agentContainerId,
      credentials: {
        host: 'zydock-db-ip-mapped-1',
        port: 5432,
        username: 'zydock',
        database: 'ip_mapped_1',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-ip-mapped-1:5432/ip_mapped_1',
        ),
      },
    });

    installAgentMock('client=10.0.0.5 4', [
      containerInfo({
        labels: { [APPLICATION_LABEL]: String(application._id) },
        addresses: { proxy: '10.0.0.5' },
      }),
    ]);

    const consumers = await findDatabaseConsumers(database, agentServer);

    expect(consumers).toEqual({
      items: [
        {
          applicationId: String(application._id),
          name: 'connects-without-declaring',
          connections: 4,
        },
      ],
    });
  });

  test('a container without the application label is ignored: its connections join otherConnections', async () => {
    const database = await databaseModel.create({
      organizationId,
      serverId: agentServerId,
      name: 'ip-mapped-2',
      slug: 'ip-mapped-2',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: agentContainerId,
      credentials: {
        host: 'zydock-db-ip-mapped-2',
        port: 5432,
        username: 'zydock',
        database: 'ip_mapped_2',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-ip-mapped-2:5432/ip_mapped_2',
        ),
      },
    });

    installAgentMock('client=10.0.0.6 2', [containerInfo({ addresses: { proxy: '10.0.0.6' } })]);

    await expect(findDatabaseConsumers(database, agentServer)).resolves.toEqual({
      items: [],
      otherConnections: 2,
    });
  });

  test('an ip with no matching container joins otherConnections, never distributed by guess', async () => {
    const database = await databaseModel.create({
      organizationId,
      serverId: agentServerId,
      name: 'ip-mapped-3',
      slug: 'ip-mapped-3',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: agentContainerId,
      credentials: {
        host: 'zydock-db-ip-mapped-3',
        port: 5432,
        username: 'zydock',
        database: 'ip_mapped_3',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-ip-mapped-3:5432/ip_mapped_3',
        ),
      },
    });

    installAgentMock('client=10.0.0.7 5', []);

    await expect(findDatabaseConsumers(database, agentServer)).resolves.toEqual({
      items: [],
      otherConnections: 5,
    });
  });

  test('a container with no addresses (stopped) never generates an entry', async () => {
    const application = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId: agentServerId,
      name: 'stopped-container-app',
      slug: 'stopped-container-app',
      source: 'git',
    });

    const database = await databaseModel.create({
      organizationId,
      serverId: agentServerId,
      name: 'ip-mapped-4',
      slug: 'ip-mapped-4',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: agentContainerId,
      credentials: {
        host: 'zydock-db-ip-mapped-4',
        port: 5432,
        username: 'zydock',
        database: 'ip_mapped_4',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-ip-mapped-4:5432/ip_mapped_4',
        ),
      },
    });

    installAgentMock('client=10.0.0.8 1', [
      containerInfo({ labels: { [APPLICATION_LABEL]: String(application._id) } }),
    ]);

    await expect(findDatabaseConsumers(database, agentServer)).resolves.toEqual({
      items: [],
      otherConnections: 1,
    });
  });

  test('an application that declares and connects, one that only declares, and one that only connects', async () => {
    const declaresOnly = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId: agentServerId,
      name: 'declares-only',
      slug: 'declares-only',
      source: 'git',
      variables: [
        { key: 'DATABASE_HOST', value: encryptSecret('zydock-db-ip-mapped-5'), secret: false },
      ],
    });

    const connectsOnly = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId: agentServerId,
      name: 'connects-only',
      slug: 'connects-only',
      source: 'git',
    });

    const declaresAndConnects = await applicationModel.create({
      organizationId,
      projectId,
      environmentId,
      serverId: agentServerId,
      name: 'declares-and-connects',
      slug: 'declares-and-connects',
      source: 'git',
      variables: [
        { key: 'DATABASE_HOST', value: encryptSecret('zydock-db-ip-mapped-5'), secret: false },
      ],
    });

    const database = await databaseModel.create({
      organizationId,
      serverId: agentServerId,
      name: 'ip-mapped-5',
      slug: 'ip-mapped-5',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'managed',
      containerId: agentContainerId,
      credentials: {
        host: 'zydock-db-ip-mapped-5',
        port: 5432,
        username: 'zydock',
        database: 'ip_mapped_5',
        password: encryptSecret('secret'),
        connectionUri: encryptSecret(
          'postgresql://zydock:secret@zydock-db-ip-mapped-5:5432/ip_mapped_5',
        ),
      },
    });

    installAgentMock(
      ['client=10.0.0.10 3', 'client=10.0.0.11 6', 'client=10.0.0.99 2'].join('\n'),
      [
        containerInfo({
          labels: { [APPLICATION_LABEL]: String(connectsOnly._id) },
          addresses: { proxy: '10.0.0.10' },
        }),
        containerInfo({
          labels: { [APPLICATION_LABEL]: String(declaresAndConnects._id) },
          addresses: { proxy: '10.0.0.11' },
        }),
      ],
    );

    const consumers = await findDatabaseConsumers(database, agentServer);

    expect(consumers.otherConnections).toBe(2);
    expect(consumers.degraded).toBeUndefined();

    expect(consumers.items).toEqual(
      expect.arrayContaining([
        {
          applicationId: String(declaresOnly._id),
          name: 'declares-only',
          variableKey: 'DATABASE_HOST',
        },
        {
          applicationId: String(declaresAndConnects._id),
          name: 'declares-and-connects',
          variableKey: 'DATABASE_HOST',
          connections: 6,
        },
        {
          applicationId: String(connectsOnly._id),
          name: 'connects-only',
          connections: 3,
        },
      ]),
    );
    expect(consumers.items).toHaveLength(3);

    const serialized = JSON.stringify(consumers);

    expect(serialized).not.toContain('10.0.0.10');
    expect(serialized).not.toContain('10.0.0.11');
    expect(serialized).not.toContain('10.0.0.99');
    expect(serialized).not.toContain('secret');
  });
});
