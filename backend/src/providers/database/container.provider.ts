import config from '../../config';
import { storeArchive } from '../../utils/archive';
import type { ContainerInfo, ContainerSpec } from '../container/container.contract';
import type {
  DatabaseBackup,
  DatabaseBackupSpec,
  DatabaseCredentials,
  DatabaseInstance,
  DatabaseProvider,
  DatabaseProviderDependencies,
  DatabaseSpec,
  DatabaseStatus,
  ProvisionedDatabase,
} from './database.contract';

/**
 * Everything one engine needs that the others do not: the image, the port it listens on, where it
 * keeps its data, how credentials become environment (or a command), and how a connection URI reads.
 * The lifecycle around it is identical for every engine, so it lives in the shared factory below.
 */
export type EngineConfig = {
  image: (version: string) => string;
  port: number;
  dataPath: string;
  /** The default admin/owner user; Redis has none, so it is optional. */
  username?: string;
  environment: (credentials: EngineCredentials) => Record<string, string>;
  /** Some engines take the password as a command flag (Redis) rather than an env var. */
  command?: (credentials: EngineCredentials) => string[];
  connectionUri: (credentials: EngineCredentials & { host: string }) => string;
  /** Command run inside the container that writes the whole dump to standard output. */
  dump: (credentials: DatabaseCredentials) => string[];
  /** Command run inside the container that reads a dump from standard input. */
  restore: (credentials: DatabaseCredentials) => string[];
  /** Redis only loads its snapshot at startup, so a restore is only visible after a restart. */
  restartAfterRestore?: boolean;
  /** Extension of the dump file, so a downloaded backup opens with the right tool. */
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

// base64url has no `@`, `:` or `/`, so a generated password drops straight into a connection URI.
const generatePassword = () => {
  const buffer = new Uint8Array(PASSWORD_BYTES);

  crypto.getRandomValues(buffer);

  return Buffer.from(buffer).toString('base64url');
};

/** The container name doubles as the network hostname other containers dial. */
const containerNameOf = (name: string) => `zydock-db-${name}`;

const volumeNameOf = (name: string) => `zydock-db-${name}-data`;

const toStatus = (container: ContainerInfo | null): DatabaseStatus =>
  container ? (STATE_TO_STATUS[container.state] ?? 'unknown') : 'unknown';

const toInstance = (container: ContainerInfo, spec: DatabaseSpec): DatabaseInstance => ({
  id: container.id,
  name: spec.name,
  engine: spec.engine,
  version: spec.version,
  status: toStatus(container),
  createdAt: container.startedAt ?? new Date().toISOString(),
});

/**
 * A database is a container like any other, so the whole lifecycle is delegated to the
 * `ContainerProvider` (the agent). Each engine plugs in only its own knowledge through `EngineConfig`.
 */
export const createContainerDatabaseProvider = (
  engine: EngineConfig,
  { containers, storage }: DatabaseProviderDependencies,
): DatabaseProvider => {
  const provision = async (spec: DatabaseSpec): Promise<ProvisionedDatabase> => {
    const containerName = containerNameOf(spec.name);
    const credentials: EngineCredentials = {
      username: engine.username ?? 'default',
      password: generatePassword(),
      database: spec.name,
      port: engine.port,
    };

    // A named volume keeps the data across restarts and image upgrades.
    await containers.createVolume(volumeNameOf(spec.name));

    // The shared network lets applications reach the database by its container name.
    await containers.createNetwork(config.proxy.network);

    const containerSpec: ContainerSpec = {
      name: containerName,
      image: engine.image(spec.version),
      environment: { ...engine.environment(credentials), ...spec.environment },
      command: engine.command?.(credentials),
      ports: [{ containerPort: engine.port, protocol: 'tcp' }],
      volumes: [{ source: volumeNameOf(spec.name), target: engine.dataPath }],
      networks: [config.proxy.network],
      labels: { 'zydock.database': spec.name, 'zydock.autoheal': 'true' },
      restartPolicy: 'unless-stopped',
    };

    const created = await containers.createContainer(containerSpec);

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

  const getStatus = async (id: string): Promise<DatabaseStatus> =>
    toStatus(await containers.inspectContainer(id));

  const unsupportedCredentials = (): Promise<DatabaseCredentials> => {
    // Credentials are generated at provision and stored (encrypted) by the databases module; the
    // provider is not their source of truth, so there is nothing to read back from the container.
    throw new Error('Credentials are managed by the databases module, not the provider');
  };

  /** The dump is produced inside the container and streamed straight into storage. */
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
    start: id => containers.startContainer(id),
    stop: id => containers.stopContainer(id),
    restart: id => containers.restartContainer(id),
    destroy: (id, removeData) => containers.removeContainer(id, removeData),
    getStatus,
    getCredentials: unsupportedCredentials,
    backup,
    restore,
  };
};

export { containerNameOf, volumeNameOf };
