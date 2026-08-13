import { z } from 'zod';
import { errorMessage } from '../../utils';
import { describeConnectionFailure } from '../../utils/network';
import type { RegistryProvider, RegistryProviderOptions, RegistryTag } from './registry.contract';

const BASE_URL = 'https://hub.docker.com/v2';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const tagResultSchema = z.object({
  name: z.string(),
  last_updated: z.string().optional(),
});

const tagsResponseSchema = z.object({
  results: z.array(z.unknown()).default([]),
  next: z.string().nullable().optional(),
});

const toRepositoryPath = (repository: string) =>
  repository.includes('/') ? repository : `library/${repository}`;

const toTag = (result: unknown): RegistryTag | null => {
  const parsed = tagResultSchema.safeParse(result);

  if (!parsed.success) {
    return null;
  }

  return {
    name: parsed.data.name,
    updatedAt: parsed.data.last_updated ? new Date(parsed.data.last_updated) : undefined,
  };
};

export const createDockerHubProvider = (options: RegistryProviderOptions): RegistryProvider => {
  const fetchPage = async (url: string) => {
    let response: Response;

    try {
      response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      throw new Error(
        `Docker Hub did not answer GET ${url}: ${await describeConnectionFailure(url, error)}`,
      );
    }

    if (!response.ok) {
      throw new Error(`Docker Hub refused GET ${url}: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');

    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Docker Hub response for ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`Docker Hub returned invalid JSON for ${url}: ${errorMessage(error)}`);
    }

    const parsed = tagsResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new Error(`Docker Hub returned an unexpected payload for ${url}`);
    }

    return {
      tags: parsed.data.results.map(toTag).filter((tag): tag is RegistryTag => tag !== null),
      next: parsed.data.next ?? null,
    };
  };

  return {
    listTags: async repository => {
      const tags: RegistryTag[] = [];

      let url: string | null =
        `${BASE_URL}/repositories/${toRepositoryPath(repository)}/tags?page_size=${PAGE_SIZE}`;
      let page = 0;

      while (url && page < MAX_PAGES) {
        const result = await fetchPage(url);

        tags.push(...result.tags);
        url = result.next;
        page += 1;
      }

      return tags;
    },

    tagExists: async (repository, tag) => {
      const url = `${BASE_URL}/repositories/${toRepositoryPath(repository)}/tags/${encodeURIComponent(tag)}/`;

      let response: Response;

      try {
        response = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new Error(
          `Docker Hub did not answer HEAD ${url}: ${await describeConnectionFailure(url, error)}`,
        );
      }

      if (response.status === 404) {
        return false;
      }

      if (!response.ok) {
        throw new Error(`Docker Hub refused HEAD ${url}: HTTP ${response.status}`);
      }

      return true;
    },
  };
};
