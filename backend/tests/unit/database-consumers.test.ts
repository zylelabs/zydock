import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { encryptSecret } from '../../src/utils/crypto';
import applicationModel from '../../src/modules/applications/application.model';
import databaseModel from '../../src/modules/databases/database.model';
import { findDatabaseConsumers } from '../../src/modules/databases/database.service';

const organizationId = new mongoose.Types.ObjectId();
const projectId = new mongoose.Types.ObjectId();
const environmentId = new mongoose.Types.ObjectId();
const serverId = new mongoose.Types.ObjectId();

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

    const consumers = await findDatabaseConsumers(database);

    expect(consumers).toEqual([
      {
        applicationId: String(application._id),
        name: 'linked-app',
        variableKey: 'DATABASE_URL',
      },
    ]);
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

    const consumers = await findDatabaseConsumers(database);

    expect(consumers).toEqual([
      {
        applicationId: String(application._id),
        name: 'consumer-by-host',
        variableKey: 'DATABASE_HOST',
      },
    ]);
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

    const consumers = await findDatabaseConsumers(database);

    expect(consumers).toEqual([
      {
        applicationId: String(application._id),
        name: 'consumer-by-uri',
        variableKey: 'DATABASE_URL',
      },
    ]);
    consumers.forEach(consumer => {
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

    await expect(findDatabaseConsumers(database)).resolves.toEqual([]);
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

    await expect(findDatabaseConsumers(database)).resolves.toEqual([]);
  });
});
