import { listRegistryTags } from '../../providers/registry';
import type { DatabaseEngineName } from './database.schema';

const REPOSITORY_OF: Record<DatabaseEngineName, string> = {
  postgresql: 'postgres',
  mysql: 'mysql',
  mongodb: 'mongo',
  redis: 'redis',
};

const FALLBACK_VERSIONS: Record<DatabaseEngineName, string[]> = {
  postgresql: [
    '18-alpine',
    '17-alpine',
    '16-alpine',
    '15-alpine',
    '14-alpine',
    '13-alpine',
    '12-alpine',
    '11-alpine',
    '10-alpine',
    '9.6-alpine',
  ],
  mysql: ['9.7', '9.6', '9.5', '9.4', '9.3', '9.2', '9.1', '9.0', '8.4', '8.0'],
  mongodb: ['8.3', '8.2', '8.1', '8.0', '7.3', '7.2', '7.1', '7.0', '6.0', '5.0'],
  redis: [
    '8.10-alpine',
    '8-alpine',
    '7.4-alpine',
    '7.2-alpine',
    '7-alpine',
    '6.2-alpine',
    '6-alpine',
    '5-alpine',
    '4-alpine',
    '3.2-alpine',
  ],
};

const VERSION_COUNT = 10;
const ALPINE_TAG = /^(\d+)(?:\.(\d+))?-alpine$/;
const PLAIN_TAG = /^(\d+)\.(\d+)$/;

const ALPINE_ENGINES: DatabaseEngineName[] = ['postgresql', 'redis'];

const tagKey = (name: string, pattern: RegExp): [number, number] | null => {
  const match = pattern.exec(name);

  if (!match) {
    return null;
  }

  return [Number(match[1]), match[2] !== undefined ? Number(match[2]) : -1];
};

const topVersions = (tagNames: string[], pattern: RegExp): string[] => {
  const parsed = tagNames
    .map(name => ({ name, key: tagKey(name, pattern) }))
    .filter((entry): entry is { name: string; key: [number, number] } => entry.key !== null)
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1]);

  const seen = new Set<string>();
  const versions: string[] = [];

  for (const entry of parsed) {
    const dedupeKey = `${entry.key[0]}.${entry.key[1]}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    versions.push(entry.name);

    if (versions.length >= VERSION_COUNT) {
      break;
    }
  }

  return versions;
};

export const fetchEngineVersions = async (engine: DatabaseEngineName): Promise<string[]> => {
  const pattern = ALPINE_ENGINES.includes(engine) ? ALPINE_TAG : PLAIN_TAG;

  try {
    const tags = await listRegistryTags('docker.io', REPOSITORY_OF[engine]);

    if (!tags) {
      return FALLBACK_VERSIONS[engine];
    }

    const versions = topVersions(
      tags.map(tag => tag.name),
      pattern,
    );

    return versions.length ? versions : FALLBACK_VERSIONS[engine];
  } catch {
    return FALLBACK_VERSIONS[engine];
  }
};

export const fetchAllEngineVersions = async (): Promise<Record<DatabaseEngineName, string[]>> => {
  const engines = Object.keys(REPOSITORY_OF) as DatabaseEngineName[];
  const entries = await Promise.all(
    engines.map(async engine => [engine, await fetchEngineVersions(engine)] as const),
  );

  return Object.fromEntries(entries) as Record<DatabaseEngineName, string[]>;
};
