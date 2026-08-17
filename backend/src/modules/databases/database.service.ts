import type { DatabaseCredentials, DatabaseStats } from '../../providers/database';
import { resolveContainerProvider } from '../../providers/container';
import { resolveDatabaseProvider, type DatabaseStatus } from '../../providers/database';
import { volumeNameOf } from '../../providers/database/container.provider';
import { ENGINES } from '../../providers/database/engines';
import { resolveStorageProvider } from '../../providers/storage';
import { errorMessage, generateUniqueSlug } from '../../utils';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { logError } from '../../utils/logger';
import {
  decryptVariables,
  findApplicationNames,
  findApplicationWithSecrets,
  listApplicationsOfOrganization,
} from '../applications/application.service';
import { composeContainerNameOf } from '../deployments/naming';
import { buildAgentConnection, listServersOfOrganization } from '../servers/server.service';
import databaseModel from './database.model';
import type { CreateDatabaseDTO, DatabaseEngineName } from './database.schema';
import { DEFAULT_VERSIONS } from './database.schema';

const ENGINE_DEFAULT_USERNAME: Record<DatabaseEngineName, string> = {
  postgresql: 'postgres',
  mysql: 'root',
  mongodb: 'root',
  redis: 'default',
};

const ENGINE_DEFAULT_DATABASE: Partial<Record<DatabaseEngineName, string>> = {
  postgresql: 'postgres',
};

const uniqueSlug = (serverId: string, name: string) =>
  generateUniqueSlug(name, 'database', async slug =>
    Boolean(await databaseModel.exists({ serverId, slug })),
  );

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
  if (database.source === 'compose') {
    await databaseModel.deleteOne({ _id: database._id });

    return;
  }

  const provider = providerOf(server, database.engine);
  const containers = resolveContainerProvider(buildAgentConnection(server));

  if (database.containerId) {
    await provider.destroy(database.containerId, removeData);
  }

  if (removeData) {
    await containers
      .removeVolume(volumeNameOf(database.slug))
      .catch(error =>
        logError('Failed to remove the database volume', error, { database: database.slug }),
      );
  }

  await databaseModel.deleteOne({ _id: database._id });
};

export const dumpExtensionOf = (engine: DatabaseEngineName) => ENGINES[engine].extension;

const resolveCredentialRef = (
  ref: DatabaseCredentialRef | undefined,
  variables: Array<{ key: string; value: string }>,
): string | undefined => {
  if (!ref) {
    return undefined;
  }

  if (ref.value !== undefined) {
    return ref.value;
  }

  return ref.key ? variables.find(variable => variable.key === ref.key)?.value : undefined;
};

export const resolveComposeCredentials = async (
  database: ManagedDatabase,
): Promise<DatabaseCredentials> => {
  if (database.source !== 'compose' || !database.link) {
    throw new Error('This database is not linked to a compose application');
  }

  const application = await findApplicationWithSecrets(
    String(database.organizationId),
    database.link.applicationId,
  );

  if (!application) {
    throw new Error('The application this database is linked to no longer exists');
  }

  const variables = decryptVariables(application.variables);
  const password = resolveCredentialRef(database.link.password, variables);

  if (password === undefined) {
    throw new Error(
      `Variable "${database.link.password.key}" was not found in "${application.name}"'s .env`,
    );
  }

  const engine: DatabaseEngineName = database.engine;
  const host =
    database.containerName ?? composeContainerNameOf(application.slug, database.link.service);
  const port = ENGINES[engine].port;
  const username =
    resolveCredentialRef(database.link.username, variables) ?? ENGINE_DEFAULT_USERNAME[engine];
  const databaseName =
    resolveCredentialRef(database.link.database, variables) ??
    ENGINE_DEFAULT_DATABASE[engine] ??
    username;

  return {
    host,
    port,
    username,
    database: databaseName,
    password,
    connectionUri: ENGINES[engine].connectionUri({
      username,
      password,
      host,
      port,
      database: databaseName,
    }),
  };
};

const backupSpecOf = async (database: ManagedDatabase, storageKey: string) => {
  if (!database.containerId) {
    throw new Error('This database has no container yet');
  }

  return {
    containerId: database.containerId,
    credentials: await readCredentials(database),
    storageKey,
  };
};

export const backupDatabase = async (
  database: ManagedDatabase,
  server: Server,
  storageKey: string,
) => providerOf(server, database.engine).backup(await backupSpecOf(database, storageKey));

export const restoreDatabase = async (
  database: ManagedDatabase,
  server: Server,
  storageKey: string,
) => providerOf(server, database.engine).restore(await backupSpecOf(database, storageKey));

export const readCredentials = async (database: ManagedDatabase): Promise<DatabaseCredentials> => {
  if (database.source === 'compose') {
    return resolveComposeCredentials(database);
  }

  const credentials = database.credentials!;

  return {
    host: credentials.host,
    port: credentials.port,
    username: credentials.username,
    database: credentials.database,
    password: decryptSecret(credentials.password),
    connectionUri: decryptSecret(credentials.connectionUri),
  };
};

const composeConsumerOf = async (database: ManagedDatabase): Promise<DatabaseConsumer[]> => {
  if (!database.link) {
    return [];
  }

  const [application] = await findApplicationNames([database.link.applicationId]);

  if (!application) {
    return [];
  }

  return [
    {
      applicationId: String(application._id),
      name: application.name,
      variableKey: database.link.password.key!,
    },
  ];
};

const managedConsumersOf = async (database: ManagedDatabase): Promise<DatabaseConsumer[]> => {
  const credentials = await readCredentials(database);
  const applications = await listApplicationsOfOrganization(String(database.organizationId));
  const consumers: DatabaseConsumer[] = [];

  for (const application of applications) {
    const variable = decryptVariables(application.variables).find(
      candidate =>
        candidate.value === credentials.host || candidate.value === credentials.connectionUri,
    );

    if (variable) {
      consumers.push({
        applicationId: String(application._id),
        name: application.name,
        variableKey: variable.key,
      });
    }
  }

  return consumers;
};

export const findDatabaseConsumers = (database: ManagedDatabase): Promise<DatabaseConsumer[]> =>
  database.source === 'compose' ? composeConsumerOf(database) : managedConsumersOf(database);

const uptimeSecondsOf = (startedAt?: string) =>
  startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
    : undefined;

const measureDatabase = async (
  database: ManagedDatabase,
  server: Server,
): Promise<DatabaseStats & { uptimeSeconds?: number }> => {
  const credentials = await readCredentials(database);
  const containers = resolveContainerProvider(buildAgentConnection(server));

  const [stats, container] = await Promise.all([
    providerOf(server, database.engine).getStats(database.containerId!, credentials),
    containers.inspectContainer(database.containerId!),
  ]);

  return { ...stats, uptimeSeconds: uptimeSecondsOf(container?.startedAt) };
};

export type DatabaseStatsResult = DatabaseStats & {
  uptimeSeconds?: number;
  degraded?: { reason: string };
};

export const fetchDatabaseStats = async (
  database: ManagedDatabase,
  server: Server,
): Promise<DatabaseStatsResult> => {
  if (!database.containerId) {
    return {};
  }

  if (!server.agent.token) {
    return { degraded: { reason: 'This server has no agent yet' } };
  }

  try {
    return await measureDatabase(database, server);
  } catch (error) {
    return { degraded: { reason: errorMessage(error) } };
  }
};

export type DatabaseStatsItem = DatabaseStats & { databaseId: string; uptimeSeconds?: number };

export type ServerDegradation = { serverId: string; reason: string };

export const fetchOrganizationDatabaseStats = async (
  organizationId: string,
): Promise<{ items: DatabaseStatsItem[]; degraded?: ServerDegradation[] }> => {
  const [databases, servers] = await Promise.all([
    listDatabasesOfOrganizationWithSecrets(organizationId),
    listServersOfOrganization(organizationId).select('+agent.token'),
  ]);

  const serverById = new Map(servers.map(server => [String(server._id), server]));

  const outcomes = await Promise.all(
    databases.map(async database => {
      const databaseId = String(database._id);
      const server = serverById.get(String(database.serverId));

      if (!database.containerId || !server) {
        return { item: { databaseId } as DatabaseStatsItem };
      }

      if (!server.agent.token) {
        return {
          item: { databaseId } as DatabaseStatsItem,
          degraded: { serverId: String(server._id), reason: 'This server has no agent yet' },
        };
      }

      try {
        const stats = await measureDatabase(database, server);

        return { item: { databaseId, ...stats } };
      } catch (error) {
        return {
          item: { databaseId } as DatabaseStatsItem,
          degraded: { serverId: String(server._id), reason: errorMessage(error) },
        };
      }
    }),
  );

  const degradedByServer = new Map<string, string>();

  for (const outcome of outcomes) {
    if (outcome.degraded && !degradedByServer.has(outcome.degraded.serverId)) {
      degradedByServer.set(outcome.degraded.serverId, outcome.degraded.reason);
    }
  }

  return {
    items: outcomes.map(outcome => outcome.item),
    degraded: degradedByServer.size
      ? [...degradedByServer.entries()].map(([serverId, reason]) => ({ serverId, reason }))
      : undefined,
  };
};

export const registerComposeDatabases = async (
  application: Application,
  databases: TemplateDatabase[],
) => {
  for (const entry of databases) {
    const slug = `${application.slug}-${entry.service}`;
    const containerName = composeContainerNameOf(application.slug, entry.service);

    await databaseModel.create({
      organizationId: application.organizationId,
      serverId: application.serverId,
      name: `${application.name} (${entry.service})`,
      slug,
      engine: entry.engine,
      status: 'provisioning',
      source: 'compose',
      containerId: containerName,
      containerName,
      link: {
        applicationId: application._id,
        service: entry.service,
        username: entry.credentials.username,
        password: entry.credentials.password,
        database: entry.credentials.database,
      },
    });
  }
};

export const unlinkDatabasesOfApplications = (applicationIds: string[]) =>
  databaseModel.deleteMany({ 'link.applicationId': { $in: applicationIds } });

export const unlinkComposeDatabasesOfServices = (applicationId: string, services: string[]) =>
  databaseModel.deleteMany({
    'link.applicationId': applicationId,
    'link.service': { $in: services },
  });

export const findDatabasesOfApplication = (applicationId: string) =>
  databaseModel.find({ 'link.applicationId': applicationId });

export const listDatabasesOfOrganization = (organizationId: string) =>
  databaseModel.find({ organizationId }).sort({ createdAt: 1 });

const listDatabasesOfOrganizationWithSecrets = (organizationId: string) =>
  databaseModel
    .find({ organizationId })
    .select('+credentials.password +credentials.connectionUri')
    .sort({ createdAt: 1 });

const connectionOf = (database: ManagedDatabase) => {
  if (database.source === 'managed') {
    const credentials = database.credentials!;

    return {
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      database: credentials.database,
    };
  }

  const link = database.link!;
  const engine: DatabaseEngineName = database.engine;

  return {
    host: database.containerName ?? '',
    port: ENGINES[engine].port,
    username: link.username?.value ?? ENGINE_DEFAULT_USERNAME[engine],
    database: link.database?.value ?? ENGINE_DEFAULT_DATABASE[engine] ?? '',
  };
};

export const serializeDatabase = (database: ManagedDatabase) => ({
  id: String(database._id),
  organizationId: String(database.organizationId),
  serverId: String(database.serverId),
  name: database.name,
  slug: database.slug,
  engine: database.engine,
  version: database.version,
  status: database.status,
  source: database.source,
  containerId: database.containerId,
  application: database.link
    ? { id: String(database.link.applicationId), service: database.link.service }
    : undefined,
  connection: connectionOf(database),
  lastError: database.lastError,
  createdAt: database.createdAt,
  updatedAt: database.updatedAt,
});
