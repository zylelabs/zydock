import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { logWarn } from '../../utils/logger';
import { resolveServerId } from '../agent/identity.service';
import { parseLine, resolveContainerId, type AccessLogEntry } from './proxy.access.service';

const containers = resolveContainerProvider();

export type AccessBucket = {
  host: string;
  minute: string;
  total: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  statusOther: number;
  durationSumMs: number;
  durationMaxMs: number;
  durationLe100: number;
  durationLe300: number;
  durationLe1000: number;
  durationLe3000: number;
  durationGt3000: number;
};

const emptyBucket = (host: string, minute: string): AccessBucket => ({
  host,
  minute,
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

export const floorToMinute = (at: string) => `${at.slice(0, 16)}:00.000Z`;

const STATUS_KEYS = ['status2xx', 'status3xx', 'status4xx', 'status5xx', 'statusOther'] as const;

const statusKey = (status: number): (typeof STATUS_KEYS)[number] => {
  if (status >= 200 && status < 300) {
    return 'status2xx';
  }

  if (status >= 300 && status < 400) {
    return 'status3xx';
  }

  if (status >= 400 && status < 500) {
    return 'status4xx';
  }

  if (status >= 500 && status < 600) {
    return 'status5xx';
  }

  return 'statusOther';
};

const DURATION_KEYS = [
  'durationLe100',
  'durationLe300',
  'durationLe1000',
  'durationLe3000',
  'durationGt3000',
] as const;

const durationKey = (durationMs: number): (typeof DURATION_KEYS)[number] => {
  if (durationMs <= 100) {
    return 'durationLe100';
  }

  if (durationMs <= 300) {
    return 'durationLe300';
  }

  if (durationMs <= 1000) {
    return 'durationLe1000';
  }

  if (durationMs <= 3000) {
    return 'durationLe3000';
  }

  return 'durationGt3000';
};

export const accumulate = (buckets: Map<string, AccessBucket>, entry: AccessLogEntry) => {
  const minute = floorToMinute(entry.at);
  const key = `${entry.host}|${minute}`;
  const bucket = buckets.get(key) ?? emptyBucket(entry.host, minute);

  bucket.total += 1;
  bucket[statusKey(entry.status)] += 1;
  bucket.durationSumMs += entry.durationMs;
  bucket.durationMaxMs = Math.max(bucket.durationMaxMs, entry.durationMs);
  bucket[durationKey(entry.durationMs)] += 1;

  buckets.set(key, bucket);
};

let cursor: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

const pushBatch = async (buckets: AccessBucket[]) => {
  const serverId = await resolveServerId();

  const response = await fetch(`${config.backendUrl}/api/agent/proxy-access/${serverId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': config.agentToken,
    },
    body: JSON.stringify({ buckets }),
  });

  if (!response.ok) {
    throw new Error(`backend answered ${response.status}`);
  }
};

export const flushAccessAggregates = async () => {
  const id = await resolveContainerId();
  const logs = await containers.getLogs(id, {
    since: cursor,
    tail: config.proxy.accessAggregateMaxTailLines,
  });
  const buckets = new Map<string, AccessBucket>();

  let latest = cursor;

  for (const log of logs) {
    const entry = parseLine(log.message);

    if (!entry || (cursor && entry.at <= cursor)) {
      continue;
    }

    accumulate(buckets, entry);

    if (!latest || entry.at > latest) {
      latest = entry.at;
    }
  }

  cursor = latest ?? cursor;

  if (!buckets.size) {
    return;
  }

  await pushBatch([...buckets.values()]);
};

export const startAccessAggregation = () => {
  cursor = new Date().toISOString();

  const tick = () => {
    flushAccessAggregates().catch(error => {
      logWarn('Proxy access aggregation failed, will retry', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  timer = setInterval(tick, config.proxy.accessAggregateIntervalSeconds * 1000);
};

export const stopAccessAggregation = () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};
