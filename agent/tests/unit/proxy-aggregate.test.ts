import { describe, expect, test } from 'bun:test';
import {
  accumulate,
  floorToMinute,
  type AccessBucket,
} from '../../src/modules/proxy/proxy.aggregate.service';
import type { AccessLogEntry } from '../../src/modules/proxy/proxy.access.service';

const entry = (overrides: Partial<AccessLogEntry> = {}): AccessLogEntry => ({
  at: '2026-08-06T12:34:56.789Z',
  host: 'app.example.com',
  method: 'GET',
  path: '/',
  status: 200,
  durationMs: 42,
  remoteIp: '203.0.113.1',
  size: 100,
  ...overrides,
});

describe('floorToMinute', () => {
  test('truncates seconds and milliseconds', () => {
    expect(floorToMinute('2026-08-06T12:34:56.789Z')).toBe('2026-08-06T12:34:00.000Z');
  });
});

describe('accumulate', () => {
  test('groups entries of the same host and minute into one bucket', () => {
    const buckets = new Map<string, AccessBucket>();

    accumulate(buckets, entry({ status: 200, durationMs: 50 }));
    accumulate(buckets, entry({ status: 404, durationMs: 150 }));
    accumulate(buckets, entry({ status: 500, durationMs: 5000 }));
    accumulate(buckets, entry({ status: 0, durationMs: 1 }));

    expect(buckets.size).toBe(1);

    const [bucket] = buckets.values();

    expect(bucket).toMatchObject({
      host: 'app.example.com',
      minute: '2026-08-06T12:34:00.000Z',
      total: 4,
      status2xx: 1,
      status4xx: 1,
      status5xx: 1,
      statusOther: 1,
      durationSumMs: 50 + 150 + 5000 + 1,
      durationMaxMs: 5000,
      durationLe100: 2,
      durationLe300: 1,
      durationLe3000: 0,
      durationGt3000: 1,
    });
  });

  test('splits entries of different hosts or minutes into separate buckets', () => {
    const buckets = new Map<string, AccessBucket>();

    accumulate(buckets, entry({ host: 'a.example.com' }));
    accumulate(buckets, entry({ host: 'b.example.com' }));
    accumulate(buckets, entry({ host: 'a.example.com', at: '2026-08-06T12:35:10.000Z' }));

    expect(buckets.size).toBe(3);
  });
});
