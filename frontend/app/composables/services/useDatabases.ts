import type { Paginated } from '../useApi';

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

export interface DatabaseFilter {
  serverId?: string;
  engine?: DatabaseEngine;
}

export const useDatabases = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/databases`;

  const list = (filter: DatabaseFilter = {}) =>
    api.get<Paginated<Database>>(base(), { query: { size: 100, ...filter } });

  return { list };
};
