import accessAggregateModel from './access-aggregate.model';
import { AccessAggregateBucketDTO, DEFAULT_STATS_MINUTES } from './access-aggregate.schema';
import { findApplicationNames } from '../applications/application.service';
import { findDomainsByHostnames } from '../domains/domain.service';

export const recordAccessAggregates = async (
  serverId: string,
  buckets: AccessAggregateBucketDTO[],
) => {
  if (!buckets.length) {
    return;
  }

  const hostnames = [...new Set(buckets.map(bucket => bucket.host))];
  const domains = await findDomainsByHostnames(hostnames);
  const domainByHostname = new Map(domains.map(domain => [domain.hostname, domain]));

  await Promise.all(
    buckets.map(bucket => {
      const domain = domainByHostname.get(bucket.host);

      return accessAggregateModel.updateOne(
        { serverId, host: bucket.host, minute: new Date(bucket.minute) },
        {
          $inc: {
            total: bucket.total,
            status2xx: bucket.status2xx,
            status3xx: bucket.status3xx,
            status4xx: bucket.status4xx,
            status5xx: bucket.status5xx,
            statusOther: bucket.statusOther,
            durationSumMs: bucket.durationSumMs,
            durationLe100: bucket.durationLe100,
            durationLe300: bucket.durationLe300,
            durationLe1000: bucket.durationLe1000,
            durationLe3000: bucket.durationLe3000,
            durationGt3000: bucket.durationGt3000,
          },
          $max: { durationMaxMs: bucket.durationMaxMs },
          $setOnInsert: {
            applicationId: domain?.applicationId ?? null,
            domainId: domain?._id ?? null,
            organizationId: domain?.organizationId ?? null,
          },
        },
        { upsert: true },
      );
    }),
  );
};

const DURATION_BUCKET_KEYS = [
  'durationLe100',
  'durationLe300',
  'durationLe1000',
  'durationLe3000',
  'durationGt3000',
] as const;

const DURATION_UPPER_BOUNDS_MS = [100, 300, 1000, 3000, 6000];

const estimateP95 = (docs: AccessAggregate[]): number => {
  const counts = DURATION_BUCKET_KEYS.map(key =>
    docs.reduce((sum, doc) => sum + (doc[key] ?? 0), 0),
  );

  const total = counts.reduce((sum, count) => sum + count, 0);

  if (!total) {
    return 0;
  }

  const target = total * 0.95;
  let cumulative = 0;
  let lowerBound = 0;

  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    const upperBound = DURATION_UPPER_BOUNDS_MS[index] ?? lowerBound;
    const next = cumulative + count;

    if (next >= target) {
      const fraction = count ? (target - cumulative) / count : 0;

      return Math.round(lowerBound + fraction * (upperBound - lowerBound));
    }

    cumulative = next;
    lowerBound = upperBound;
  }

  return lowerBound;
};

const errorCount = (doc: AccessAggregate) => doc.status4xx + doc.status5xx + doc.statusOther;

const buildSeries = (docs: AccessAggregate[]): AccessStatsPoint[] => {
  const byMinute = new Map<string, AccessAggregate[]>();

  for (const doc of docs) {
    const key = doc.minute.toISOString();
    const bucket = byMinute.get(key) ?? [];

    bucket.push(doc);
    byMinute.set(key, bucket);
  }

  return [...byMinute.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, minuteDocs]) => {
      const requests = minuteDocs.reduce((sum, doc) => sum + doc.total, 0);
      const errors = minuteDocs.reduce((sum, doc) => sum + errorCount(doc), 0);

      return {
        minute,
        requests,
        errorRate: requests ? Math.round((errors / requests) * 100) / 100 : 0,
        p95Ms: estimateP95(minuteDocs),
      };
    });
};

const TOP_HOSTS_LIMIT = 10;

const buildTopHosts = async (docs: AccessAggregate[]): Promise<AccessStatsHost[]> => {
  const byHost = new Map<string, { applicationId: string | null; requests: number }>();

  for (const doc of docs) {
    const entry = byHost.get(doc.host) ?? {
      applicationId: doc.applicationId ? String(doc.applicationId) : null,
      requests: 0,
    };

    entry.requests += doc.total;
    byHost.set(doc.host, entry);
  }

  const applicationIds = [
    ...new Set(
      [...byHost.values()].flatMap(entry => (entry.applicationId ? [entry.applicationId] : [])),
    ),
  ];
  const applications = await findApplicationNames(applicationIds);
  const nameById = new Map(
    applications.map(application => [String(application._id), application.name]),
  );

  return [...byHost.entries()]
    .map(([host, entry]) => ({
      host,
      applicationId: entry.applicationId,
      applicationName: entry.applicationId ? (nameById.get(entry.applicationId) ?? null) : null,
      requests: entry.requests,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, TOP_HOSTS_LIMIT);
};

const buildStats = async (
  docs: AccessAggregate[],
  filtered: boolean,
): Promise<AccessStatsResult> => ({
  series: buildSeries(docs),
  topHosts: await buildTopHosts(docs),
  filtered,
});

export const fetchServerAccessStats = async (
  serverId: string,
  organizationId: string,
  superuser: boolean,
  minutes = DEFAULT_STATS_MINUTES,
): Promise<AccessStatsResult> => {
  const since = new Date(Date.now() - minutes * 60_000);
  const filter: Record<string, unknown> = { serverId, minute: { $gte: since } };

  if (!superuser) {
    filter.organizationId = organizationId;
  }

  const docs = await accessAggregateModel.find(filter);

  return buildStats(docs, !superuser);
};

export const fetchApplicationAccessStats = async (
  hostnames: string[],
  minutes = DEFAULT_STATS_MINUTES,
): Promise<AccessStatsResult> => {
  if (!hostnames.length) {
    return { series: [], topHosts: [], filtered: false };
  }

  const since = new Date(Date.now() - minutes * 60_000);
  const docs = await accessAggregateModel.find({
    host: { $in: hostnames },
    minute: { $gte: since },
  });

  return buildStats(docs, false);
};
