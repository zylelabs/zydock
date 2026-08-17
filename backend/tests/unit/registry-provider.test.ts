import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDockerHubProvider } from '../../src/providers/registry/dockerhub.provider';
import { createGhcrProvider } from '../../src/providers/registry/ghcr.provider';
import {
  listRegistryTags,
  registryTagExists,
  resolveRegistryProvider,
} from '../../src/providers/registry';

const originalFetch = globalThis.fetch;

let calls: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
});

const mockFetch = (handler: (url: string) => Response | Promise<Response>) => {
  globalThis.fetch = (async (url: string) => {
    calls.push(url);

    return handler(url);
  }) as typeof fetch;
};

describe('createDockerHubProvider', () => {
  test('paginates until the next link runs out', async () => {
    mockFetch(url => {
      if (url.includes('page=2')) {
        return new Response(
          JSON.stringify({
            results: [{ name: '1.2.0', last_updated: '2024-02-01T00:00:00Z' }],
            next: null,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          results: [{ name: '1.1.0', last_updated: '2024-01-01T00:00:00Z' }],
          next: 'https://hub.docker.com/v2/repositories/library/postgres/tags?page=2',
        }),
        { status: 200 },
      );
    });

    const provider = createDockerHubProvider({ timeoutMs: 5000 });
    const tags = await provider.listTags('postgres');

    expect(calls).toHaveLength(2);
    expect(tags.map(tag => tag.name)).toEqual(['1.1.0', '1.2.0']);
    expect(tags[0]!.updatedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  test('prefixes a repository without a namespace with library/', async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [], next: null }), { status: 200 }));

    const provider = createDockerHubProvider({ timeoutMs: 5000 });

    await provider.listTags('postgres');

    expect(calls[0]).toContain('/repositories/library/postgres/tags');
  });

  test('does not prefix a repository that already has a namespace', async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [], next: null }), { status: 200 }));

    const provider = createDockerHubProvider({ timeoutMs: 5000 });

    await provider.listTags('louislam/uptime-kuma');

    expect(calls[0]).toContain('/repositories/louislam/uptime-kuma/tags');
  });

  test('drops only the malformed item instead of failing the whole page', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            results: [{ last_updated: '2024-01-01T00:00:00Z' }, { name: '2.0.0' }],
            next: null,
          }),
          { status: 200 },
        ),
    );

    const provider = createDockerHubProvider({ timeoutMs: 5000 });
    const tags = await provider.listTags('postgres');

    expect(tags).toEqual([{ name: '2.0.0', updatedAt: undefined }]);
  });

  test('throws a readable error when the JSON body is invalid', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));

    const provider = createDockerHubProvider({ timeoutMs: 5000 });

    await expect(provider.listTags('postgres')).rejects.toThrow('invalid JSON');
  });

  test('throws a readable error when the request does not answer', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    const provider = createDockerHubProvider({ timeoutMs: 50 });

    await expect(provider.listTags('postgres')).rejects.toThrow('did not answer');
  });

  test('tagExists sends a HEAD request and returns true on a 200', async () => {
    mockFetch(() => new Response(null, { status: 200 }));

    const provider = createDockerHubProvider({ timeoutMs: 5000 });

    await expect(provider.tagExists('louislam/uptime-kuma', '2.1.3')).resolves.toBe(true);
    expect(calls[0]).toContain('/repositories/louislam/uptime-kuma/tags/2.1.3/');
  });

  test('tagExists returns false on a 404', async () => {
    mockFetch(() => new Response(null, { status: 404 }));

    const provider = createDockerHubProvider({ timeoutMs: 5000 });

    await expect(provider.tagExists('louislam/uptime-kuma', 'does-not-exist')).resolves.toBe(false);
  });

  test('tagExists throws a readable error when the request does not answer', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    const provider = createDockerHubProvider({ timeoutMs: 50 });

    await expect(provider.tagExists('louislam/uptime-kuma', '2.1.3')).rejects.toThrow(
      'did not answer',
    );
  });
});

describe('createGhcrProvider', () => {
  const tokenResponse = () =>
    new Response(JSON.stringify({ token: 'tok-1', expires_in: 300 }), { status: 200 });

  test('fetches a token before the first /v2/ call and sends it as a bearer token', async () => {
    const requests: { url: string; headers: Record<string, string> }[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requests.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });

      if (url.includes('/token')) {
        return tokenResponse();
      }

      return new Response(JSON.stringify({ tags: ['1.0.0'] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });

    await provider.listTags('owner/app');

    expect(requests[0]!.url).toContain('/token');
    expect(requests[1]!.url).toContain('/v2/owner/app/tags/list');
    expect(requests[1]!.headers.Authorization).toBe('Bearer tok-1');
  });

  test('reuses the token between calls for the same repository', async () => {
    let tokenCalls = 0;

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/token')) {
        tokenCalls += 1;

        return tokenResponse();
      }

      return new Response(JSON.stringify({ tags: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });

    await provider.listTags('owner/app');
    await provider.listTags('owner/app');

    expect(tokenCalls).toBe(1);
  });

  test('paginates following the Link "rel=next" header and stops at the page cap', async () => {
    let pageCalls = 0;

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/token')) {
        return tokenResponse();
      }

      pageCalls += 1;

      return new Response(JSON.stringify({ tags: [`tag-${pageCalls}`] }), {
        status: 200,
        headers: { link: '<https://ghcr.io/v2/owner/app/tags/list?n=100&last=x>; rel="next"' },
      });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });
    const tags = await provider.listTags('owner/app');

    expect(pageCalls).toBe(10);
    expect(tags).toHaveLength(10);
  });

  test('a null "tags" field (empty repository) resolves to an empty list without throwing', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/token')) {
        return tokenResponse();
      }

      return new Response(JSON.stringify({ tags: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });

    await expect(provider.listTags('owner/empty')).resolves.toEqual([]);
  });

  test('tags come back without an updatedAt', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/token')) {
        return tokenResponse();
      }

      return new Response(JSON.stringify({ tags: ['1.0.0', '2.0.0'] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });
    const tags = await provider.listTags('owner/app');

    expect(tags).toEqual([{ name: '1.0.0' }, { name: '2.0.0' }]);
  });

  test('tagExists: 200 -> true, 404 -> false, 401 -> throws', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/token')) {
        return tokenResponse();
      }

      if (url.includes('/manifests/missing')) {
        return new Response(null, { status: 404 });
      }

      if (url.includes('/manifests/private')) {
        return new Response(null, { status: 401 });
      }

      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createGhcrProvider({ timeoutMs: 5000 });

    await expect(provider.tagExists('owner/app', '1.0.0')).resolves.toBe(true);
    await expect(provider.tagExists('owner/app', 'missing')).resolves.toBe(false);
    await expect(provider.tagExists('owner/app', 'private')).rejects.toThrow('HTTP 401');
  });
});

describe('resolveRegistryProvider', () => {
  test('resolves docker.io to the Docker Hub implementation', () => {
    expect(resolveRegistryProvider('docker.io')).not.toBeNull();
  });

  test('resolves ghcr.io to the GHCR implementation', () => {
    expect(resolveRegistryProvider('ghcr.io')).not.toBeNull();
  });

  test('returns null for an allowlisted host without a registered implementation', () => {
    expect(resolveRegistryProvider('quay.io')).toBeNull();
  });

  test('returns null for a host outside the registry allowlist', () => {
    expect(resolveRegistryProvider('evil.example.com')).toBeNull();
  });
});

describe('registryTagExists', () => {
  test('returns true when the tag exists', async () => {
    mockFetch(() => new Response(null, { status: 200 }));

    await expect(registryTagExists('docker.io', 'louislam/uptime-kuma', '2.1.3')).resolves.toBe(
      true,
    );
  });

  test('returns false when the tag is confirmed missing (404)', async () => {
    mockFetch(() => new Response(null, { status: 404 }));

    await expect(
      registryTagExists('docker.io', 'louislam/uptime-kuma', 'does-not-exist'),
    ).resolves.toBe(false);
  });

  test('returns null (unknown, permissive) when the registry does not answer', async () => {
    globalThis.fetch = (async () => {
      throw new Error('registry unreachable');
    }) as unknown as typeof fetch;

    await expect(
      registryTagExists('docker.io', 'louislam/uptime-kuma', '2.1.3'),
    ).resolves.toBeNull();
  });

  test('returns null for a host without a registered implementation', async () => {
    await expect(registryTagExists('quay.io', 'owner/app', '1.0.0')).resolves.toBeNull();
  });
});

describe('listRegistryTags — cache', () => {
  const originalDateNow = Date.now;

  beforeEach(() => {
    Date.now = originalDateNow;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  test('does not fetch again while the cache is fresh', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ results: [{ name: '1.0.0' }], next: null }), { status: 200 }),
    );

    const repository = `cache-fresh-${Date.now()}`;

    const first = await listRegistryTags('docker.io', repository);
    const second = await listRegistryTags('docker.io', repository);

    expect(calls).toHaveLength(1);
    expect(first).toEqual(second);
  });

  test('serves the stale cached value when a later fetch fails', async () => {
    const repository = `cache-stale-${Date.now()}`;

    mockFetch(
      () =>
        new Response(JSON.stringify({ results: [{ name: '1.0.0' }], next: null }), { status: 200 }),
    );

    const first = await listRegistryTags('docker.io', repository);

    Date.now = () => originalDateNow() + 7 * 60 * 60 * 1000;

    globalThis.fetch = (async () => {
      throw new Error('registry unreachable');
    }) as unknown as typeof fetch;

    const second = await listRegistryTags('docker.io', repository);

    expect(second).toEqual(first);
  });

  test('does not collide between docker.io and ghcr.io for the same repository path', async () => {
    const repository = `same-path-${Date.now()}`;

    globalThis.fetch = (async (url: string) => {
      if (url.includes('hub.docker.com')) {
        return new Response(JSON.stringify({ results: [{ name: 'docker-tag' }], next: null }), {
          status: 200,
        });
      }

      if (url.includes('/token')) {
        return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
      }

      return new Response(JSON.stringify({ tags: ['ghcr-tag'] }), { status: 200 });
    }) as unknown as typeof fetch;

    const dockerTags = await listRegistryTags('docker.io', repository);
    const ghcrTags = await listRegistryTags('ghcr.io', repository);

    expect(dockerTags?.map(tag => tag.name)).toEqual(['docker-tag']);
    expect(ghcrTags?.map(tag => tag.name)).toEqual(['ghcr-tag']);
  });
});
