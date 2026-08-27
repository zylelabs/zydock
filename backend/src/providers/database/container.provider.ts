import config from '../../config';
import { storeArchive } from '../../utils/archive';
import type { ContainerInfo, ContainerSpec } from '../container/container.contract';
import type {
  DatabaseBackup,
  DatabaseBackupSpec,
  DatabaseCredentials,
  DatabaseInstance,
  DatabasePublishOptions,
  DatabaseProvider,
  DatabaseProviderDependencies,
  DatabaseSpec,
  DatabaseStats,
  DatabaseStatus,
  ProvisionedDatabase,
} from './database.contract';

export type EngineConfig = {
  image: (version: string) => string;
  port: number;
  dataPath: string;
  username?: string;
  environment: (credentials: EngineCredentials) => Record<string, string>;
  command?: (credentials: EngineCredentials) => string[];
  connectionUri: (credentials: EngineCredentials & { host: string }) => string;
  dump: (credentials: DatabaseCredentials) => string[];
  restore: (credentials: DatabaseCredentials) => string[];
  stats: (credentials: DatabaseCredentials) => string[];
  clients: (credentials: DatabaseCredentials) => string[];
  restartAfterRestore?: boolean;
  extension: string;
};

export type EngineCredentials = {
  username: string;
  password: string;
  database: string;
  port: number;
};

const STATE_TO_STATUS: Record<string, DatabaseStatus> = {
  created: 'provisioning',
  restarting: 'provisioning',
  running: 'running',
  paused: 'stopped',
  exited: 'stopped',
  dead: 'failed',
};

const PASSWORD_BYTES = 24;

const generatePassword = () => {
  const buffer = new Uint8Array(PASSWORD_BYTES);

  crypto.getRandomValues(buffer);

  return Buffer.from(buffer).toString('base64url');
};

const containerNameOf = (name: string) => `zydock-db-${name}`;

const volumeNameOf = (name: string) => `zydock-db-${name}-data`;

const toStatus = (container: ContainerInfo | null): DatabaseStatus =>
  container ? (STATE_TO_STATUS[container.state] ?? 'unknown') : 'unknown';

const NUMERIC_STATS_KEYS = [
  'sizeBytes',
  'connections',
  'maxConnections',
  'diskTotalBytes',
  'diskUsedBytes',
  'dataPathSizeBytes',
] as const;

const parseStats = (stdout: string): DatabaseStats => {
  const values: Partial<Record<(typeof NUMERIC_STATS_KEYS)[number] | 'versionLabel', string>> = {};

  for (const line of stdout.split('\n')) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === 'versionLabel' || (NUMERIC_STATS_KEYS as readonly string[]).includes(key)) {
      values[key as keyof typeof values] = value;
    }
  }

  const toNumber = (value?: string) => {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    sizeBytes: toNumber(values.sizeBytes) ?? toNumber(values.dataPathSizeBytes),
    connections: toNumber(values.connections),
    maxConnections: toNumber(values.maxConnections),
    versionLabel: values.versionLabel,
    diskTotalBytes: toNumber(values.diskTotalBytes),
    diskUsedBytes: toNumber(values.diskUsedBytes),
  };
};

const parseClients = (stdout: string): Record<string, number> => {
  const clients: Record<string, number> = {};

  for (const line of stdout.split('\n')) {
    if (!line.startsWith('client=')) {
      continue;
    }

    const separatorIndex = line.indexOf(' ', 'client='.length);

    if (separatorIndex <= 0) {
      continue;
    }

    const ip = line.slice('client='.length, separatorIndex).trim();
    const count = Number(line.slice(separatorIndex + 1).trim());

    if (!ip || !Number.isFinite(count)) {
      continue;
    }

    clients[ip] = count;
  }

  return clients;
};

const toInstance = (container: ContainerInfo, spec: DatabaseSpec): DatabaseInstance => ({
  id: container.id,
  name: spec.name,
  engine: spec.engine,
  version: spec.version,
  status: toStatus(container),
  createdAt: container.startedAt ?? new Date().toISOString(),
});

const buildContainerSpec = (
  engine: EngineConfig,
  spec: DatabaseSpec,
  credentials: EngineCredentials,
  hostPort?: number,
): ContainerSpec => ({
  name: containerNameOf(spec.name),
  image: engine.image(spec.version),
  environment: { ...engine.environment(credentials), ...spec.environment },
  command: engine.command?.(credentials),
  ports: [{ containerPort: engine.port, protocol: 'tcp', ...(hostPort ? { hostPort } : {}) }],
  volumes: [{ source: volumeNameOf(spec.name), target: engine.dataPath }],
  networks: [config.proxy.network],
  labels: { 'zydock.database': spec.name, 'zydock.autoheal': 'true' },
  restartPolicy: 'unless-stopped',
});

export const createContainerDatabaseProvider = (
  engine: EngineConfig,
  { containers, storage }: DatabaseProviderDependencies,
): DatabaseProvider => {
  const launch = async (
    spec: DatabaseSpec,
    credentials: EngineCredentials,
    hostPort?: number,
  ): Promise<ProvisionedDatabase> => {
    const containerName = containerNameOf(spec.name);
    const created = await containers.createContainer(
      buildContainerSpec(engine, spec, credentials, hostPort),
    );

    await containers.startContainer(created.id);

    const started = await containers.inspectContainer(created.id);

    return {
      instance: toInstance(started ?? created, spec),
      credentials: {
        host: containerName,
        port: engine.port,
        username: credentials.username,
        password: credentials.password,
        database: credentials.database,
        connectionUri: engine.connectionUri({ ...credentials, host: containerName }),
      },
    };
  };

  const provision = async (spec: DatabaseSpec): Promise<ProvisionedDatabase> => {
    const credentials: EngineCredentials = {
      username: engine.username ?? 'default',
      password: generatePassword(),
      database: spec.name,
      port: engine.port,
    };

    await containers.createVolume(volumeNameOf(spec.name));

    await containers.createNetwork(config.proxy.network);

    return launch(spec, credentials);
  };

  const republish = async (
    spec: DatabaseSpec,
    credentials: DatabaseCredentials,
    publish?: DatabasePublishOptions,
  ): Promise<ProvisionedDatabase> => {
    const containerName = containerNameOf(spec.name);
    const engineCredentials: EngineCredentials = {
      username: credentials.username,
      password: credentials.password,
      database: credentials.database ?? spec.name,
      port: engine.port,
    };

    await containers.stopContainer(containerName).catch(() => undefined);
    await containers.removeContainer(containerName);

    return launch(spec, engineCredentials, publish?.hostPort);
  };

  const recreate = async (
    spec: DatabaseSpec,
    credentials: DatabaseCredentials,
  ): Promise<ProvisionedDatabase> => {
    const engineCredentials: EngineCredentials = {
      username: credentials.username,
      password: credentials.password,
      database: credentials.database ?? spec.name,
      port: engine.port,
    };

    await containers.createVolume(volumeNameOf(spec.name));

    await containers.createNetwork(config.proxy.network);

    return launch(spec, engineCredentials);
  };

  const getStatus = async (id: string): Promise<DatabaseStatus> =>
    toStatus(await containers.inspectContainer(id));

  const getStats = async (id: string, credentials: DatabaseCredentials): Promise<DatabaseStats> => {
    const result = await containers.execCommand(id, { command: engine.stats(credentials) });

    if (result.exitCode !== 0) {
      return {};
    }

    return parseStats(result.stdout);
  };

  const getClientConnections = async (
    id: string,
    credentials: DatabaseCredentials,
  ): Promise<Record<string, number>> => {
    const result = await containers.execCommand(id, { command: engine.clients(credentials) });

    if (result.exitCode !== 0) {
      return {};
    }

    return parseClients(result.stdout);
  };

  const unsupportedCredentials = (): Promise<DatabaseCredentials> => {
    throw new Error('Credentials are managed by the databases module, not the provider');
  };

  const backup = async ({
    containerId,
    credentials,
    storageKey,
  }: DatabaseBackupSpec): Promise<DatabaseBackup> => {
    const archive = await containers.archiveFromContainer(containerId, engine.dump(credentials));

    return {
      storageKey,
      sizeBytes: await storeArchive(storage, storageKey, archive),
      createdAt: new Date().toISOString(),
    };
  };

  const restore = async ({ containerId, credentials, storageKey }: DatabaseBackupSpec) => {
    const archive = await storage.get(storageKey);

    await containers.restoreIntoContainer(containerId, engine.restore(credentials), archive);

    if (engine.restartAfterRestore) {
      await containers.restartContainer(containerId);
    }
  };

  return {
    provision,
    republish,
    recreate,
    start: id => containers.startContainer(id),
    stop: id => containers.stopContainer(id),
    restart: id => containers.restartContainer(id),
    destroy: (id, removeData) => containers.removeContainer(id, removeData),
    getStatus,
    getCredentials: unsupportedCredentials,
    getStats,
    getClientConnections,
    backup,
    restore,
  };
};

export { containerNameOf, volumeNameOf };
