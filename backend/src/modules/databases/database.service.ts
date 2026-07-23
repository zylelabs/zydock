import { resolveContainerProvider } from '../../providers/container';
import { resolveDatabaseProvider, type DatabaseStatus } from '../../providers/database';
import { volumeNameOf } from '../../providers/database/container.provider';
import { ENGINES } from '../../providers/database/engines';
import { resolveStorageProvider } from '../../providers/storage';
import { generateUniqueSlug } from '../../utils';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { logError } from '../../utils/logger';
import { buildAgentConnection } from '../servers/server.service';
import databaseModel from './database.model';
import type { CreateDatabaseDTO, DatabaseEngineName } from './database.schema';
import { DEFAULT_VERSIONS } from './database.schema';

const uniqueSlug = (serverId: string, name: string) =>
  generateUniqueSlug(name, 'database', async slug =>
    Boolean(await databaseModel.exists({ serverId, slug })),
  );

/** The container provider (agent) and storage a database provider needs to do its work. */
const dependenciesOf = (server: Server) => ({
  containers: resolveContainerProvider(buildAgentConnection(server)),
  storage: resolveStorageProvider(),
});

export const findDatabase = (organizationId: string, databaseId: string) =>
  databaseModel.findOne({ _id: databaseId, organizationId });

export const findDatabaseWithSecrets = (organizationId: string, databaseId: string) =>
  databaseModel
    .findOne({ _id: databaseId, organizationId })
    .select('+credentials.password +credentials.connectionUri');

export const countDatabasesOfServer = (serverId: string) =>
  databaseModel.countDocuments({ serverId });

/**
 * Provisions the database as a container on the server through the engine provider, then stores the
 * generated credentials encrypted — the platform is their only source of truth, like every other
 * secret it keeps.
 */
export const provisionDatabase = async (
  organizationId: string,
  server: Server,
  body: CreateDatabaseDTO,
) => {
  const slug = await uniqueSlug(String(server._id), body.name);
  const version = body.version ?? DEFAULT_VERSIONS[body.engine as DatabaseEngineName];

  const provider = resolveDatabaseProvider(body.engine, dependenciesOf(server));

  const { instance, credentials } = await provider.provision({
    name: slug,
    engine: body.engine,
    version,
    environment: body.environment,
  });

  return databaseModel.create({
    organizationId,
    serverId: server._id,
    name: body.name,
    slug,
    engine: body.engine,
    version,
    status: instance.status,
    containerId: instance.id,
    containerName: credentials.host,
    credentials: {
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      database: credentials.database,
      password: encryptSecret(credentials.password),
      connectionUri: encryptSecret(credentials.connectionUri),
    },
  });
};

const providerOf = (server: Server, engine: DatabaseEngineName) =>
  resolveDatabaseProvider(engine, dependenciesOf(server));

const persistStatus = (databaseId: string, status: DatabaseStatus) =>
  databaseModel.updateOne({ _id: databaseId }, { $set: { status } });

/** Runs a lifecycle action on the container and refreshes the stored status from the agent. */
export const runLifecycle = async (
  database: ManagedDatabase,
  server: Server,
  action: 'start' | 'stop' | 'restart',
) => {
  if (!database.containerId) {
    throw new Error('This database has no container yet');
  }

  const provider = providerOf(server, database.engine);

  await provider[action](database.containerId);

  const status = await provider.getStatus(database.containerId);

  await persistStatus(String(database._id), status);

  return status;
};

export const refreshDatabaseStatus = async (database: ManagedDatabase, server: Server) => {
  if (!database.containerId) {
    return database.status;
  }

  const status = await providerOf(server, database.engine).getStatus(database.containerId);

  await persistStatus(String(database._id), status);

  return status;
};

export const destroyDatabase = async (
  database: ManagedDatabase,
  server: Server,
  removeData: boolean,
) => {
  const provider = providerOf(server, database.engine);
  const containers = resolveContainerProvider(buildAgentConnection(server));

  if (database.containerId) {
    await provider.destroy(database.containerId, removeData);
  }

  // The data volume is named, so `docker rm` never takes it — it goes only when asked, explicitly.
  if (removeData) {
    await containers
      .removeVolume(volumeNameOf(database.slug))
      .catch(error =>
        logError('Failed to remove the database volume', error, { database: database.slug }),
      );
  }

  await databaseModel.deleteOne({ _id: database._id });
};

/** Extension of the dump this engine produces, so a downloaded backup opens with the right tool. */
export const dumpExtensionOf = (engine: DatabaseEngineName) => ENGINES[engine].extension;

const backupSpecOf = (database: ManagedDatabase, storageKey: string) => {
  if (!database.containerId) {
    throw new Error('This database has no container yet');
  }

  return { containerId: database.containerId, credentials: readCredentials(database), storageKey };
};

/** Both take the database **with its secrets**: the engine command authenticates as the owner. */
export const backupDatabase = (database: ManagedDatabase, server: Server, storageKey: string) =>
  providerOf(server, database.engine).backup(backupSpecOf(database, storageKey));

export const restoreDatabase = (database: ManagedDatabase, server: Server, storageKey: string) =>
  providerOf(server, database.engine).restore(backupSpecOf(database, storageKey));

export const readCredentials = (database: ManagedDatabase) => ({
  host: database.credentials.host,
  port: database.credentials.port,
  username: database.credentials.username,
  database: database.credentials.database,
  password: decryptSecret(database.credentials.password),
  connectionUri: decryptSecret(database.credentials.connectionUri),
});

export const listDatabasesOfOrganization = (organizationId: string) =>
  databaseModel.find({ organizationId }).sort({ createdAt: 1 });

export const serializeDatabase = (database: ManagedDatabase) => ({
  id: String(database._id),
  organizationId: String(database.organizationId),
  serverId: String(database.serverId),
  name: database.name,
  slug: database.slug,
  engine: database.engine,
  version: database.version,
  status: database.status,
  containerId: database.containerId,
  // Non-secret parts only; the password and URI come from the credentials endpoint.
  connection: {
    host: database.credentials.host,
    port: database.credentials.port,
    username: database.credentials.username,
    database: database.credentials.database,
  },
  lastError: database.lastError,
  createdAt: database.createdAt,
  updatedAt: database.updatedAt,
});
