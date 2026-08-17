import type { ContainerProvider } from '../container/container.contract';
import type { StorageProvider } from '../storage/storage.contract';

export const DATABASE_ENGINES = ['postgresql', 'mongodb', 'redis', 'mysql'] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export type DatabaseStatus = 'provisioning' | 'running' | 'stopped' | 'failed' | 'unknown';

export type DatabaseSpec = {
  name: string;
  engine: DatabaseEngine;
  version: string;
  storageMb?: number;
  environment?: Record<string, string>;
};

export type DatabaseInstance = {
  id: string;
  name: string;
  engine: DatabaseEngine;
  version: string;
  status: DatabaseStatus;
  createdAt: string;
};

export type DatabaseCredentials = {
  host: string;
  port: number;
  username: string;
  password: string;
  connectionUri: string;
  database?: string;
};

export type DatabaseBackupSpec = {
  containerId: string;
  credentials: DatabaseCredentials;
  storageKey: string;
};

export type DatabaseBackup = {
  storageKey: string;
  sizeBytes: number;
  createdAt: string;
};

export type ProvisionedDatabase = {
  instance: DatabaseInstance;
  credentials: DatabaseCredentials;
};

export type DatabaseStats = {
  sizeBytes?: number;
  connections?: number;
  maxConnections?: number;
  versionLabel?: string;
  diskTotalBytes?: number;
  diskUsedBytes?: number;
};

export type DatabaseProvider = {
  provision: (spec: DatabaseSpec) => Promise<ProvisionedDatabase>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  destroy: (id: string, removeData?: boolean) => Promise<void>;
  getStatus: (id: string) => Promise<DatabaseStatus>;
  getCredentials: (id: string) => Promise<DatabaseCredentials>;
  getStats: (id: string, credentials: DatabaseCredentials) => Promise<DatabaseStats>;
  backup: (spec: DatabaseBackupSpec) => Promise<DatabaseBackup>;
  restore: (spec: DatabaseBackupSpec) => Promise<void>;
};

export type DatabaseProviderDependencies = {
  containers: ContainerProvider;
  storage: StorageProvider;
};

export type DatabaseProviderFactory = (
  dependencies: DatabaseProviderDependencies,
) => DatabaseProvider;
