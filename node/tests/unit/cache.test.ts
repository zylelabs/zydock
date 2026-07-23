import { describe, expect, test } from 'bun:test';
import { createTtlCache } from '../../src/utils/cache';

describe('createTtlCache', () => {
  test('get returns undefined before anything is set', () => {
    expect(createTtlCache<number>(60).get()).toBeUndefined();
  });

  test('set stores and get reads the value', () => {
    const cache = createTtlCache<string>(60);
    cache.set('hello');

    expect(cache.get()).toBe('hello');
  });

  test('the value expires after the TTL', async () => {
    const cache = createTtlCache<string>(0.01); // 10 ms
    cache.set('gone-soon');

    expect(cache.get()).toBe('gone-soon');
    await Bun.sleep(20);
    expect(cache.get()).toBeUndefined();
  });

  test('clear drops the cached value', () => {
    const cache = createTtlCache<number>(60);
    cache.set(42);
    cache.clear();

    expect(cache.get()).toBeUndefined();
  });

  test('resolve produces once and caches the result', async () => {
    const cache = createTtlCache<number>(60);
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return 7;
    };

    expect(await cache.resolve(produce)).toBe(7);
    expect(await cache.resolve(produce)).toBe(7);
    expect(calls).toBe(1);
  });

  test('resolve is single-flight: concurrent callers share one production', async () => {
    const cache = createTtlCache<number>(60);
    let calls = 0;
    const produce = async () => {
      calls += 1;
      await Bun.sleep(10);
      return 99;
    };

    const [a, b, c] = await Promise.all([
      cache.resolve(produce),
      cache.resolve(produce),
      cache.resolve(produce),
    ]);

    expect([a, b, c]).toEqual([99, 99, 99]);
    expect(calls).toBe(1);
  });
});
