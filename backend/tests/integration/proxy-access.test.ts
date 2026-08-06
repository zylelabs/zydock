import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import applicationModel from '../../src/modules/applications/application.model';
import domainModel from '../../src/modules/domains/domain.model';
import { fetchApplicationAccess, fetchServerAccess } from '../../src/modules/proxy/proxy.service';
import type {
  AccessLogEntry,
  AccessLogPage,
  ReverseProxyProvider,
} from '../../src/providers/reverse-proxy';

const objectId = () => new mongoose.Types.ObjectId().toString();

const HOST_A = 'app-a.proxy-access.test';
const HOST_B = 'app-b.proxy-access.test';
const HOST_UNMATCHED = 'unknown-host.proxy-access.test';

const accessEntry = (host: string): AccessLogEntry => ({
  at: new Date().toISOString(),
  host,
  method: 'GET',
  path: '/',
  status: 200,
  durationMs: 1,
  remoteIp: '10.0.0.1',
  size: 10,
});

const fakeProxy = (entries: AccessLogEntry[]): ReverseProxyProvider => ({
  upsertRoute: async () => undefined,
  removeRoute: async () => undefined,
  getRoute: async () => null,
  listRoutes: async () => [],
  enableTls: async () => undefined,
  getCertificateStatus: async () => {
    throw new Error('not implemented');
  },
  renewCertificate: async () => undefined,
  reload: async () => undefined,
  listAccess: async (): Promise<AccessLogPage> => ({
    items: entries,
    total: entries.length,
    page: 1,
    size: entries.length,
    pages: 1,
  }),
  streamAccess: () => ({
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) {
        yield entry;
      }
    },
  }),
});

describe('proxy access — correlation and authorization', () => {
  let organizationAId: string;
  let organizationBId: string;
  let applicationAId: string;

  beforeAll(async () => {
    await connectDatabase();

    organizationAId = objectId();
    organizationBId = objectId();

    const [applicationA, applicationB] = await applicationModel.create([
      {
        organizationId: organizationAId,
        projectId: objectId(),
        environmentId: objectId(),
        serverId: objectId(),
        name: 'App A',
        slug: 'app-a-proxy-access',
        git: { repository: 'org/app-a' },
        port: 3000,
      },
      {
        organizationId: organizationBId,
        projectId: objectId(),
        environmentId: objectId(),
        serverId: objectId(),
        name: 'App B',
        slug: 'app-b-proxy-access',
        git: { repository: 'org/app-b' },
        port: 3000,
      },
    ]);

    applicationAId = String(applicationA!._id);

    await domainModel.create([
      {
        organizationId: organizationAId,
        applicationId: applicationA!._id,
        serverId: objectId(),
        hostname: HOST_A,
      },
      {
        organizationId: organizationBId,
        applicationId: applicationB!._id,
        serverId: objectId(),
        hostname: HOST_B,
      },
    ]);
  });

  afterAll(async () => {
    await domainModel.deleteMany({ hostname: { $in: [HOST_A, HOST_B] } });
    await applicationModel.deleteMany({
      organizationId: { $in: [organizationAId, organizationBId] },
    });
    await disconnectDatabase();
  });

  test('a non-superuser member of organization A never receives the host of organization B', async () => {
    const proxy = fakeProxy([
      accessEntry(HOST_A),
      accessEntry(HOST_B),
      accessEntry(HOST_UNMATCHED),
    ]);

    const result = await fetchServerAccess(proxy, organizationAId, false, {});

    expect(result.filtered).toBe(true);
    expect(result.items.map(item => item.host)).toEqual([HOST_A]);
    expect(result.items.every(item => item.organizationId === organizationAId)).toBe(true);
  });

  test('a superuser sees every host of the server, including unmatched requests', async () => {
    const proxy = fakeProxy([
      accessEntry(HOST_A),
      accessEntry(HOST_B),
      accessEntry(HOST_UNMATCHED),
    ]);

    const result = await fetchServerAccess(proxy, organizationAId, true, {});

    expect(result.filtered).toBe(false);
    expect(result.total).toBe(3);
    expect(result.items.some(item => item.unmatched)).toBe(true);
  });

  test('the application view stays scoped to its own hostnames even when other traffic is present', async () => {
    const proxy = fakeProxy([accessEntry(HOST_A), accessEntry(HOST_B)]);

    const result = await fetchApplicationAccess(proxy, [HOST_A], {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.applicationId).toBe(applicationAId);
    expect(result.items[0]?.applicationName).toBe('App A');
  });
});
