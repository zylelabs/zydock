import { z } from 'zod';
import { errorMessage } from '../../utils';
import { describeConnectionFailure } from '../../utils/network';
import type { RegistryProvider, RegistryProviderOptions, RegistryTag } from './registry.contract';

const BASE_URL = 'https://ghcr.io';
const TOKEN_SERVICE = 'ghcr.io';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const TOKEN_EXPIRY_MARGIN_MS = 30 * 1000;
const DEFAULT_TOKEN_TTL_SECONDS = 300;
const MANIFEST_ACCEPT_HEADER = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const tokenResponseSchema = z.object({
  token: z.string(),
  expires_in: z.number().optional(),
});

const tagsListSchema = z.object({
  tags: z.array(z.string()).nullable(),
});

const encodeRepositoryPath = (repository: string) =>
  repository.split('/').map(encodeURIComponent).join('/');

const parseNextLink = (linkHeader: string | null): string | null => {
  if (!linkHeader) {
    return null;
  }

  const match = linkHeader
    .split(',')
    .map(entry => entry.trim())
    .find(entry => entry.endsWith('rel="next"'));

  if (!match) {
    return null;
  }

  const urlMatch = match.match(/^<(.+)>/);

  return urlMatch ? urlMatch[1]! : null;
};

export const createGhcrProvider = (options: RegistryProviderOptions): RegistryProvider => {
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();

  const fetchToken = async (repository: string) => {
    const cached = tokenCache.get(repository);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const path = encodeRepositoryPath(repository);
    const url = `${BASE_URL}/token?service=${TOKEN_SERVICE}&scope=repository:${path}:pull`;

    let response: Response;

    try {
      response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      throw new Error(
        `GHCR did not answer GET ${url}: ${await describeConnectionFailure(url, error)}`,
      );
    }

    if (!response.ok) {
      throw new Error(`GHCR refused GET ${url}: HTTP ${response.status}`);
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`GHCR returned invalid JSON for ${url}: ${errorMessage(error)}`);
    }

    const parsed = tokenResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new Error(`GHCR returned an unexpected token payload for ${url}`);
    }

    const ttlSeconds = parsed.data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS;

    tokenCache.set(repository, {
      token: parsed.data.token,
      expiresAt: Date.now() + ttlSeconds * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    });

    return parsed.data.token;
  };

  const fetchPage = async (url: string, token: string) => {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `GHCR did not answer GET ${url}: ${await describeConnectionFailure(url, error)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`GHCR denied GET ${url}: HTTP ${response.status} (repository is not public)`);
    }

    if (!response.ok) {
      throw new Error(`GHCR refused GET ${url}: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');

    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`GHCR response for ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`GHCR returned invalid JSON for ${url}: ${errorMessage(error)}`);
    }

    const parsed = tagsListSchema.safeParse(body);

    if (!parsed.success) {
      throw new Error(`GHCR returned an unexpected payload for ${url}`);
    }

    return {
      tags: parsed.data.tags ?? [],
      next: parseNextLink(response.headers.get('link')),
    };
  };

  return {
    listTags: async repository => {
      const token = await fetchToken(repository);
      const path = encodeRepositoryPath(repository);
      const tags: RegistryTag[] = [];

      let url: string | null = `${BASE_URL}/v2/${path}/tags/list?n=${PAGE_SIZE}`;
      let page = 0;

      while (url && page < MAX_PAGES) {
        const result = await fetchPage(url, token);

        tags.push(...result.tags.map(name => ({ name })));
        url = result.next ? new URL(result.next, BASE_URL).toString() : null;
        page += 1;
      }

      return tags;
    },

    tagExists: async (repository, tag) => {
      const token = await fetchToken(repository);
      const path = encodeRepositoryPath(repository);
      const url = `${BASE_URL}/v2/${path}/manifests/${encodeURIComponent(tag)}`;

      let response: Response;

      try {
        response = await fetch(url, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT_HEADER },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new Error(
          `GHCR did not answer HEAD ${url}: ${await describeConnectionFailure(url, error)}`,
        );
      }

      if (response.status === 404) {
        return false;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `GHCR denied HEAD ${url}: HTTP ${response.status} (repository is not public)`,
        );
      }

      if (!response.ok) {
        throw new Error(`GHCR refused HEAD ${url}: HTTP ${response.status}`);
      }

      return true;
    },
  };
};
