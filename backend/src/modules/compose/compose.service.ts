import { parse } from 'yaml';
import { resolveComposeProvider } from '../../providers/compose';
import { errorMessage, escapeRegex } from '../../utils';
import { decryptVariables } from '../applications/application.service';
import { findDatabasesOfApplication } from '../databases/database.service';
import type { DatabaseEngineName } from '../databases/database.schema';
import { composeContainerNameOf, composeProjectOf } from '../deployments/naming';
import { listDomainsOfApplication } from '../domains/domain.service';
import { fetchServerContainerMetrics } from '../metrics/metric.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';

const parsePortEntry = (entry: unknown): ParsedComposePort | null => {
  if (typeof entry === 'number') {
    return { target: entry };
  }

  if (typeof entry === 'string') {
    const [left, right] = entry.split(':');

    return right
      ? { published: Number(left), target: Number(right.split('/')[0]) }
      : { target: Number(left.split('/')[0]) };
  }

  if (entry && typeof entry === 'object') {
    const record = entry as { published?: number | string; target?: number | string };

    return {
      published: record.published === undefined ? undefined : Number(record.published),
      target: record.target === undefined ? undefined : Number(record.target),
    };
  }

  return null;
};

const parsePorts = (definition: unknown): ParsedComposePort[] => {
  if (!definition || typeof definition !== 'object' || !('ports' in definition)) {
    return [];
  }

  const raw = (definition as { ports: unknown }).ports;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(parsePortEntry).filter((port): port is ParsedComposePort => port !== null);
};

const hasMemoryLimit = (definition: unknown): boolean => {
  if (!definition || typeof definition !== 'object') {
    return false;
  }

  const deploy = (definition as { deploy?: { resources?: { limits?: { memory?: unknown } } } })
    .deploy;

  return Boolean(deploy?.resources?.limits?.memory);
};

const imageOf = (definition: unknown): string | undefined => {
  if (!definition || typeof definition !== 'object') {
    return undefined;
  }

  const image = (definition as { image?: unknown }).image;

  return typeof image === 'string' ? image : undefined;
};

export const parseComposeDocument = (content: string): ParsedCompose => {
  let document: unknown;

  try {
    document = parse(content);
  } catch (error) {
    throw new Error(
      `Invalid docker-compose.yml: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!document || typeof document !== 'object' || !('services' in document)) {
    throw new Error('The compose file must declare a "services" section');
  }

  const services = (document as { services: unknown }).services;

  if (!services || typeof services !== 'object') {
    throw new Error('The compose file must declare a "services" section');
  }

  const entries = Object.entries(services as Record<string, unknown>);

  if (!entries.length) {
    throw new Error('The compose file must declare at least one service');
  }

  return {
    services: entries.map(([name, definition]) => ({
      name,
      image: imageOf(definition),
      ports: parsePorts(definition),
      hasMemoryLimit: hasMemoryLimit(definition),
      raw: (definition && typeof definition === 'object' ? definition : {}) as Record<
        string,
        unknown
      >,
    })),
  };
};

export const findComposeService = (parsed: ParsedCompose, name: string) =>
  parsed.services.find(service => service.name === name);

export const publishedPortsOf = (parsed: ParsedCompose): number[] => [
  ...new Set(
    parsed.services
      .flatMap(service => service.ports.map(port => port.published))
      .filter((port): port is number => typeof port === 'number'),
  ),
];

export const renderEnvFile = (application: Application): string =>
  decryptVariables(application.variables)
    .map(variable => `${variable.key}=${variable.value}`)
    .join('\n');

export const secretValuesOf = (application: Application): string[] =>
  decryptVariables(application.variables)
    .filter(variable => variable.secret && variable.value.length > 0)
    .map(variable => variable.value);

export const maskSecrets = (text: string, secretValues: string[]): string =>
  secretValues.reduce(
    (masked, value) => masked.replace(new RegExp(escapeRegex(value), 'g'), '***'),
    text,
  );

export type ApplicationServiceSummary = {
  service: string;
  containerName: string;
  exposed: boolean;
  role: 'primary' | 'linked';
  image?: string;
  internalPort?: number;
};

export type ApplicationServiceDetail = ApplicationServiceSummary & {
  kind?: string;
  domain?: string;
};

const DATABASE_ENGINE_LABELS: Record<DatabaseEngineName, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
};

const imageTagOf = (image: string): string | undefined => {
  const separatorIndex = image.lastIndexOf(':');

  if (separatorIndex === -1) {
    return undefined;
  }

  const tag = image.slice(separatorIndex + 1);

  return tag.includes('/') ? undefined : tag;
};

const imageWithoutTag = (image: string): string => {
  const tag = imageTagOf(image);

  return tag ? image.slice(0, image.lastIndexOf(':')) : image;
};

const versionFromImageTag = (image?: string): string | undefined =>
  image ? imageTagOf(image)?.split('-')[0] : undefined;

const kindOf = (params: {
  isPrimary: boolean;
  image?: string;
  linkedDatabase?: ManagedDatabase;
}): string | undefined => {
  const { isPrimary, image, linkedDatabase } = params;

  if (linkedDatabase) {
    const label = DATABASE_ENGINE_LABELS[linkedDatabase.engine as DatabaseEngineName];
    const version = linkedDatabase.version ?? versionFromImageTag(image);

    return version ? `${label} ${version}` : label;
  }

  if (isPrimary) {
    return 'Application';
  }

  return image ? imageWithoutTag(image) : undefined;
};

export const listApplicationServices = (application: Application): ApplicationServiceSummary[] => {
  if (application.source !== 'compose' || !application.compose) {
    return [];
  }

  try {
    const parsed = parseComposeDocument(application.compose.content);
    const primaryService = application.compose.expose.service;

    return parsed.services.map(service => {
      const isPrimary = service.name === primaryService;
      const internalPort = isPrimary
        ? application.compose!.expose.port
        : service.ports.find(port => typeof port.target === 'number')?.target;

      return {
        service: service.name,
        containerName: composeContainerNameOf(application.slug, service.name),
        exposed: isPrimary,
        role: isPrimary ? 'primary' : 'linked',
        image: service.image,
        internalPort,
      };
    });
  } catch {
    return [];
  }
};

export const describeApplicationServices = async (
  application: Application,
): Promise<{ services: ApplicationServiceDetail[]; networkName?: string }> => {
  const services = listApplicationServices(application);

  if (services.length === 0) {
    return { services };
  }

  const [databases, domains] = await Promise.all([
    findDatabasesOfApplication(String(application._id)),
    listDomainsOfApplication(String(application._id)),
  ]);

  const primaryDomain = domains.find(domain => domain.auto) ?? domains[0];

  const detailed = services.map(service => {
    const linkedDatabase = databases.find(database => database.link?.service === service.service);

    return {
      ...service,
      kind: kindOf({ isPrimary: service.role === 'primary', image: service.image, linkedDatabase }),
      domain: service.role === 'primary' ? primaryDomain?.hostname : undefined,
    };
  });

  return {
    services: detailed,
    networkName: `${composeProjectOf(application.slug)}_default`,
  };
};

export type ApplicationServiceStatusEntry = {
  service: string;
  state: string;
  health: string;
  memoryUsedMb?: number;
  cpuPercent?: number;
};

export const fetchApplicationServiceStatus = async (
  application: Application,
): Promise<{ services: ApplicationServiceStatusEntry[]; degraded?: { reason: string } }> => {
  const declared = listApplicationServices(application);

  if (declared.length === 0) {
    return { services: [] };
  }

  const server = await findServerById(String(application.serverId));

  if (!server?.agent.token) {
    return { services: [], degraded: { reason: 'This server has no agent yet' } };
  }

  try {
    const compose = resolveComposeProvider(buildAgentConnection(server));
    const project = composeProjectOf(application.slug);

    const [statuses, containerMetrics] = await Promise.all([
      compose.ps(project),
      fetchServerContainerMetrics(server),
    ]);

    const services = declared.map(service => {
      const status = statuses.find(entry => entry.service === service.service);
      const metric = containerMetrics.find(entry => entry.name === service.containerName);

      return {
        service: service.service,
        state: status?.state ?? 'unknown',
        health: status?.health ?? 'unknown',
        memoryUsedMb: metric?.memoryUsedMb,
        cpuPercent: metric?.cpuPercent,
      };
    });

    return { services };
  } catch (error) {
    return { services: [], degraded: { reason: errorMessage(error) } };
  }
};

export const restartApplicationService = async (application: Application, service: string) => {
  const server = await findServerById(String(application.serverId));

  if (!server) {
    throw new Error(`Server ${application.serverId} not found`);
  }

  const compose = resolveComposeProvider(buildAgentConnection(server));

  await compose.restart(composeProjectOf(application.slug), service);
};

export const destroyComposeProject = async (application: Application, removeVolumes: boolean) => {
  if (application.source !== 'compose') {
    return;
  }

  const server = await findServerById(String(application.serverId));

  if (!server) {
    return;
  }

  const compose = resolveComposeProvider(buildAgentConnection(server));

  await compose.down(composeProjectOf(application.slug), removeVolumes);
};
