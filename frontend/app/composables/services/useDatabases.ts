import type { Paginated } from '../useApi';
import type { Status } from '~/components/elements/StatusDot.vue';

export const DATABASE_ENGINES = ['postgresql', 'mongodb', 'redis', 'mysql'] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export type DatabaseStatus = 'provisioning' | 'running' | 'stopped' | 'failed' | 'unknown';

export type DatabaseSource = 'managed' | 'compose';

export interface DatabasePublicAccess {
  enabled: boolean;
  hostPort?: number;
  appliedAt?: string;
}

export interface Database {
  id: string;
  organizationId: string;
  serverId: string;
  name: string;
  slug: string;
  engine: DatabaseEngine;
  version?: string;
  status: DatabaseStatus;
  source: DatabaseSource;
  containerId?: string;
  application?: { id: string; service: string };
  connection: { host: string; port: number; username: string; database: string };
  publicAccess: DatabasePublicAccess;
  externalHost?: string;
  externalPort?: number;
  publicConnectionUriMasked?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDatabaseAccessPayload {
  enabled: boolean;
  hostPort?: number;
}

export interface DatabaseFilter {
  serverId?: string;
  engine?: DatabaseEngine;
  size?: number;
}

export interface CreateDatabasePayload {
  serverId: string;
  name: string;
  engine: DatabaseEngine;
  version?: string;
  environment?: Record<string, string>;
}

export const ENGINE_VERSION_OPTIONS: Record<DatabaseEngine, string[]> = {
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

let versionsCache: { organizationId: string; versions: Record<DatabaseEngine, string[]> } | null =
  null;
let versionsPromise: Promise<Record<DatabaseEngine, string[]>> | null = null;

export const useEngineVersions = () => {
  const api = useApi();
  const session = useSessionStore();

  const load = async (): Promise<Record<DatabaseEngine, string[]>> => {
    const organizationId = session.organizationId;

    if (versionsCache?.organizationId === organizationId) {
      return versionsCache.versions;
    }

    if (!versionsPromise) {
      versionsPromise = api
        .get<{ versions: Record<DatabaseEngine, string[]> }>(
          `/organizations/${organizationId}/databases/versions`,
        )
        .then(({ versions }) => {
          versionsCache = { organizationId, versions };

          return versions;
        })
        .catch(() => ENGINE_VERSION_OPTIONS)
        .finally(() => {
          versionsPromise = null;
        });
    }

    return versionsPromise;
  };

  return { load };
};

export interface DatabaseStats {
  sizeBytes?: number;
  connections?: number;
  maxConnections?: number;
  versionLabel?: string;
  diskTotalBytes?: number;
  diskUsedBytes?: number;
  uptimeSeconds?: number;
  peakConnections?: number;
  peakWindowHours: number;
  degraded?: { reason: string };
}

export interface DatabaseStatsItem extends DatabaseStats {
  databaseId: string;
}

export interface DatabaseConsumer {
  applicationId: string;
  name: string;
  variableKey?: string;
  connections?: number;
}

export interface DatabaseCredentials {
  host: string;
  port: number;
  username: string;
  database: string;
  password: string;
  connectionUri: string;
  publicConnectionUri?: string;
}

export const databaseStatusDot = (status: DatabaseStatus): Status => {
  if (status === 'running') {
    return 'live';
  }

  if (status === 'provisioning') {
    return 'attn';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'stopped';
};

const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
};

export const engineLabel = (engine: DatabaseEngine, version?: string) =>
  version ? `${ENGINE_LABELS[engine]} ${version}` : ENGINE_LABELS[engine];

export const useDatabases = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/databases`;

  const list = (filter: DatabaseFilter = {}) =>
    api.get<Paginated<Database>>(base(), { query: { size: 100, ...filter } });
  const get = (databaseId: string) => api.get<{ database: Database }>(`${base()}/${databaseId}`);

  const create = (payload: CreateDatabasePayload) =>
    api.post<{ database: Database }>(base(), { body: payload });

  const stats = () =>
    api.get<{ items: DatabaseStatsItem[]; degraded?: { serverId: string; reason: string }[] }>(
      `${base()}/stats`,
    );
  const statsOf = (databaseId: string) => api.get<DatabaseStats>(`${base()}/${databaseId}/stats`);
  const consumers = (databaseId: string) =>
    api.get<{
      items: DatabaseConsumer[];
      otherConnections?: number;
      degraded?: { reason: string };
    }>(`${base()}/${databaseId}/consumers`);
  const credentials = (databaseId: string) =>
    api.get<{ credentials: DatabaseCredentials }>(`${base()}/${databaseId}/credentials`);

  const start = (databaseId: string) =>
    api.post<{ status: DatabaseStatus }>(`${base()}/${databaseId}/start`);
  const stop = (databaseId: string) =>
    api.post<{ status: DatabaseStatus }>(`${base()}/${databaseId}/stop`);
  const restart = (databaseId: string) =>
    api.post<{ status: DatabaseStatus }>(`${base()}/${databaseId}/restart`);
  const remove = (databaseId: string, removeData?: boolean) =>
    api.del<{ message: string }>(`${base()}/${databaseId}`, { query: { removeData } });

  const updateAccess = (databaseId: string, payload: UpdateDatabaseAccessPayload) =>
    api.patch<{ database: Database }>(`${base()}/${databaseId}/access`, { body: payload });

  return {
    list,
    get,
    create,
    stats,
    statsOf,
    consumers,
    credentials,
    start,
    stop,
    restart,
    remove,
    updateAccess,
  };
};
