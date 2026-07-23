import type { Paginated } from '~/composables/use-api';

export const DATABASE_ENGINES = ['postgresql', 'mongodb', 'redis', 'mysql'] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export type DatabaseStatus = 'provisioning' | 'running' | 'stopped' | 'failed' | 'unknown';

export interface Database {
  id: string;
  organizationId: string;
  serverId: string;
  name: string;
  slug: string;
  engine: DatabaseEngine;
  version: string;
  status: DatabaseStatus;
  containerId?: string;
  connection: { host: string; port: number; username: string; database: string };
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseCredentials {
  host: string;
  port: number;
  username: string;
  database: string;
  password: string;
  connectionUri: string;
}

export interface CreateDatabaseBody {
  serverId: string;
  name: string;
  engine: DatabaseEngine;
  version?: string;
}

export const useDatabases = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/databases`;

  const list = (filter: { serverId?: string; engine?: DatabaseEngine } = {}) =>
    api.get<Paginated<Database>>(base(), { query: { size: 100, ...filter } });
  const create = (body: CreateDatabaseBody) => api.post<{ database: Database }>(base(), { body });
  const credentials = (databaseId: string) =>
    api.get<{ credentials: DatabaseCredentials }>(`${base()}/${databaseId}/credentials`);
  const lifecycle = (databaseId: string, action: 'start' | 'stop' | 'restart') =>
    api.post<{ status: DatabaseStatus }>(`${base()}/${databaseId}/${action}`);
  const remove = (databaseId: string, removeData = false) =>
    api.del<{ message: string }>(`${base()}/${databaseId}`, { query: { removeData } });

  return { list, create, credentials, lifecycle, remove };
};
