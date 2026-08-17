import config from '../../config';
import { createDockerHubProvider } from './dockerhub.provider';
import { createGhcrProvider } from './ghcr.provider';
import type { RegistryProvider, RegistryProviderFactory, RegistryTag } from './registry.contract';

const factories: Record<string, RegistryProviderFactory> = {
  'docker.io': createDockerHubProvider,
  'ghcr.io': createGhcrProvider,
};

type CacheEntry = { tags: RegistryTag[]; expiresAt: number };

const cache = new Map<string, CacheEntry>();

const cacheKey = (host: string, repository: string) => `${host}:${repository}`;

export const resolveRegistryProvider = (host: string): RegistryProvider | null => {
  if (!config.compose.registryAllowlist.includes(host)) {
    return null;
  }

  const factory = factories[host];

  if (!factory) {
    return null;
  }

  return factory({ timeoutMs: config.providers.registry.timeoutMs });
};

export const listRegistryTags = async (
  host: string,
  repository: string,
): Promise<RegistryTag[] | null> => {
  if (!config.providers.registry.enabled) {
    return null;
  }

  const provider = resolveRegistryProvider(host);

  if (!provider) {
    return null;
  }

  const key = cacheKey(host, repository);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.tags;
  }

  try {
    const tags = await provider.listTags(repository);

    cache.set(key, {
      tags,
      expiresAt: Date.now() + config.providers.registry.ttlHours * 60 * 60 * 1000,
    });

    return tags;
  } catch (error) {
    if (cached) {
      return cached.tags;
    }

    throw error;
  }
};

export const registryTagExists = async (
  host: string,
  repository: string,
  tag: string,
): Promise<boolean | null> => {
  if (!config.providers.registry.enabled) {
    return null;
  }

  const provider = resolveRegistryProvider(host);

  if (!provider) {
    return null;
  }

  try {
    return await provider.tagExists(repository, tag);
  } catch {
    return null;
  }
};

export type * from './registry.contract';
