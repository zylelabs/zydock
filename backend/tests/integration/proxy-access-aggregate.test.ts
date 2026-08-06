import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import applicationModel from '../../src/modules/applications/application.model';
import domainModel from '../../src/modules/domains/domain.model';
import accessAggregateModel from '../../src/modules/proxy/access-aggregate.model';
import { AccessAggregateBucketDTO } from '../../src/modules/proxy/access-aggregate.schema';
import {
  fetchApplicationAccessStats,
  fetchServerAccessStats,
  recordAccessAggregates,
} from '../../src/modules/proxy/access-aggregate.service';

const objectId = () => new mongoose.Types.ObjectId().toString();

const HOST_A = 'app-a.proxy-access-aggregate.test';
const HOST_B = 'app-b.proxy-access-aggregate.test';
const HOST_UNMATCHED = 'unknown-host.proxy-access-aggregate.test';

const minute = (offsetMinutes: number) => {
  const at = new Date();

  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + offsetMinutes);

  return at.toISOString();
};

const emptyBucket = (host: string, minuteIso: string): AccessAggregateBucketDTO => ({
  host,
  minute: minuteIso,
  total: 0,
  status2xx: 0,
  status3xx: 0,
  status4xx: 0,
  status5xx: 0,
  statusOther: 0,
  durationSumMs: 0,
  durationMaxMs: 0,
  durationLe100: 0,
  durationLe300: 0,
  durationLe1000: 0,
  durationLe3000: 0,
  durationGt3000: 0,
});

describe('proxy access aggregate — ingest and stats', () => {
  let organizationAId: string;
  let organizationBId: string;
  let applicationAId: string;
  let serverId: string;
  const minuteIso = minute(0);

  beforeAll(async () => {
    await connectDatabase();

    organizationAId = objectId();
    organizationBId = objectId();
    serverId = objectId();

    const [applicationA, applicationB] = await applicationModel.create([
      {
        organizationId: organizationAId,
        projectId: objectId(),
        environmentId: objectId(),
        serverId,
        name: 'App A',
        slug: 'app-a-proxy-access-aggregate',
        git: { repository: 'org/app-a' },
        port: 3000,
      },
      {
        organizationId: organizationBId,
        projectId: objectId(),
        environmentId: objectId(),
        serverId,
        name: 'App B',
        slug: 'app-b-proxy-access-aggregate',
        git: { repository: 'org/app-b' },
        port: 3000,
      },
    ]);

    applicationAId = String(applicationA!._id);

    await domainModel.create([
      {
        organizationId: organizationAId,
        applicationId: applicationA!._id,
        serverId,
        hostname: HOST_A,
      },
      {
        organizationId: organizationBId,
        applicationId: applicationB!._id,
        serverId,
        hostname: HOST_B,
      },
    ]);

    await recordAccessAggregates(serverId, [
      {
        ...emptyBucket(HOST_A, minuteIso),
        total: 18,
        status2xx: 16,
        status4xx: 2,
        durationSumMs: 900,
        durationMaxMs: 250,
        durationLe100: 16,
        durationLe300: 2,
      },
      {
        ...emptyBucket(HOST_B, minuteIso),
        total: 5,
        status2xx: 5,
        durationSumMs: 50,
        durationMaxMs: 20,
        durationLe100: 5,
      },
      {
        ...emptyBucket(HOST_UNMATCHED, minuteIso),
        total: 1,
        statusOther: 1,
      },
    ]);

    // A second, smaller batch for HOST_A merges into the same (server, host, minute) document.
    await recordAccessAggregates(serverId, [
      { ...emptyBucket(HOST_A, minuteIso), total: 2, status2xx: 2, durationLe100: 2 },
    ]);
  });

  afterAll(async () => {
    await accessAggregateModel.deleteMany({ serverId });
    await domainModel.deleteMany({ hostname: { $in: [HOST_A, HOST_B] } });
    await applicationModel.deleteMany({
      organizationId: { $in: [organizationAId, organizationBId] },
    });
    await disconnectDatabase();
  });

  test('batches merge into a single counter document per (server, host, minute)', async () => {
    const doc = await accessAggregateModel.findOne({ serverId, host: HOST_A });

    expect(doc?.total).toBe(20);
    expect(doc?.status2xx).toBe(18);
    expect(doc?.applicationId?.toString()).toBe(applicationAId);
  });

  test('a non-superuser member of organization A never sees the stats of organization B', async () => {
    const result = await fetchServerAccessStats(serverId, organizationAId, false);

    expect(result.filtered).toBe(true);
    expect(result.topHosts.map(entry => entry.host)).toEqual([HOST_A]);
    expect(result.series[0]?.requests).toBe(20);
  });

  test('a superuser sees every host of the server, including unmatched requests', async () => {
    const result = await fetchServerAccessStats(serverId, organizationAId, true);

    expect(result.filtered).toBe(false);
    expect(result.topHosts.map(entry => entry.host).sort()).toEqual(
      [HOST_A, HOST_B, HOST_UNMATCHED].sort(),
    );

    const total = result.series.reduce((sum, point) => sum + point.requests, 0);

    expect(total).toBe(26);
  });

  test('the application view stays scoped to its own hostnames', async () => {
    const result = await fetchApplicationAccessStats([HOST_A]);

    expect(result.topHosts).toHaveLength(1);
    expect(result.topHosts[0]?.applicationName).toBe('App A');
    expect(result.series[0]?.errorRate).toBeCloseTo(2 / 20, 2);
    expect(result.series[0]?.p95Ms).toBeGreaterThan(0);
    expect(result.series[0]?.p95Ms).toBeLessThanOrEqual(300);
  });
});
