import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import { describeApplicationServices } from '../../src/modules/compose/compose.service';
import databaseModel from '../../src/modules/databases/database.model';
import domainModel from '../../src/modules/domains/domain.model';

const applicationId = new mongoose.Types.ObjectId();
const organizationId = new mongoose.Types.ObjectId();
const serverId = new mongoose.Types.ObjectId();

const application = {
  _id: applicationId,
  source: 'compose',
  slug: 'stack-detail',
  compose: {
    content:
      'services:\n' +
      '  app:\n' +
      '    image: myorg/app:1.2\n' +
      '  db:\n' +
      '    image: postgres:16-alpine\n' +
      '  cache:\n' +
      '    image: redis:7-alpine\n' +
      '  worker:\n' +
      '    image: myorg/worker:1.2\n',
    expose: { service: 'app', port: 8080 },
  },
} as unknown as Application;

beforeAll(async () => {
  await connectDatabase();
});

afterEach(async () => {
  await databaseModel.deleteMany({ 'link.applicationId': applicationId });
  await domainModel.deleteMany({ applicationId });
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('describeApplicationServices', () => {
  test('uses the registered engine and version for a linked database', async () => {
    await databaseModel.create({
      organizationId,
      serverId,
      name: 'stack-detail (db)',
      slug: 'stack-detail-db',
      engine: 'postgresql',
      version: '16',
      status: 'running',
      source: 'compose',
      link: { applicationId, service: 'db', password: { value: 'x' } },
    });

    const { services } = await describeApplicationServices(application);

    expect(services.find(service => service.service === 'db')?.kind).toBe('PostgreSQL 16');
  });

  test('falls back to the image tag when the registered database has no version', async () => {
    await databaseModel.create({
      organizationId,
      serverId,
      name: 'stack-detail (cache)',
      slug: 'stack-detail-cache',
      engine: 'redis',
      status: 'running',
      source: 'compose',
      link: { applicationId, service: 'cache', password: { value: 'x' } },
    });

    const { services } = await describeApplicationServices(application);

    expect(services.find(service => service.service === 'cache')?.kind).toBe('Redis 7');
  });

  test('labels the primary service without a linked database as "Application"', async () => {
    const { services } = await describeApplicationServices(application);

    expect(services.find(service => service.service === 'app')?.kind).toBe('Application');
  });

  test('labels a linked service with no registered database by its image name, without tag', async () => {
    const { services } = await describeApplicationServices(application);

    expect(services.find(service => service.service === 'worker')?.kind).toBe('myorg/worker');
  });

  test('sets the domain only on the primary service', async () => {
    await domainModel.create({
      organizationId,
      applicationId,
      serverId,
      hostname: 'stack-detail.zydock.test',
      auto: true,
      status: 'active',
    });

    const { services } = await describeApplicationServices(application);

    expect(services.find(service => service.service === 'app')?.domain).toBe(
      'stack-detail.zydock.test',
    );
    expect(services.find(service => service.service === 'db')?.domain).toBeUndefined();
  });
});
