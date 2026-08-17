import type { Paginated } from '../useApi';
import type { Status } from '~/components/elements/StatusDot.vue';

export const DATABASE_ENGINES = ['postgresql', 'mongodb', 'redis', 'mysql'] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export type DatabaseStatus = 'provisioning' | 'running' | 'stopped' | 'failed' | 'unknown';

export type DatabaseSource = 'managed' | 'compose';

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
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseFilter {
  serverId?: string;
  engine?: DatabaseEngine;
  size?: number;
}

export interface DatabaseStats {
  sizeBytes?: number;
  connections?: number;
  maxConnections?: number;
  versionLabel?: string;
  diskTotalBytes?: number;
  diskUsedBytes?: number;
  uptimeSeconds?: number;
  degraded?: { reason: string };
}

export interface DatabaseStatsItem extends DatabaseStats {
  databaseId: string;
}

export interface DatabaseConsumer {
  applicationId: string;
  name: string;
  variableKey: string;
}

export interface DatabaseCredentials {
  host: string;
  port: number;
  username: string;
  database: string;
  password: string;
  connectionUri: string;
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

  const stats = () =>
    api.get<{ items: DatabaseStatsItem[]; degraded?: { serverId: string; reason: string }[] }>(
      `${base()}/stats`,
    );
  const statsOf = (databaseId: string) => api.get<DatabaseStats>(`${base()}/${databaseId}/stats`);
  const consumers = (databaseId: string) =>
    api.get<{ items: DatabaseConsumer[] }>(`${base()}/${databaseId}/consumers`);
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

  return { list, get, stats, statsOf, consumers, credentials, start, stop, restart, remove };
};
