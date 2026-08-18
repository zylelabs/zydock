import { parse } from 'yaml';
import { resolveComposeProvider } from '../../providers/compose';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage, escapeRegex } from '../../utils';
import { decryptSecret } from '../../utils/crypto';
import { decryptVariables } from '../applications/application.service';
import { findDatabasesOfApplication } from '../databases/database.service';
import type { DatabaseEngineName } from '../databases/database.schema';
import { composeContainerNameOf, composeProjectOf, containerNameOf } from '../deployments/naming';
import { listDomainsOfApplication } from '../domains/domain.service';
import { fetchServerContainerMetrics } from '../metrics/metric.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';

const toPortNumber = (value: unknown): number | undefined => {
  const port = Number(value);

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
};

const parsePortEntry = (entry: unknown): ParsedComposePort | null => {
  if (typeof entry === 'number') {
    return { target: toPortNumber(entry), protocol: 'tcp' };
  }

  if (typeof entry === 'string') {
    const [left, right] = entry.split(':');
    const [targetValue, protocolSuffix] = (right ?? left).split('/');
    const protocol: 'tcp' | 'udp' = protocolSuffix === 'udp' ? 'udp' : 'tcp';

    return right
      ? { published: toPortNumber(left), target: toPortNumber(targetValue), protocol }
      : { target: toPortNumber(targetValue), protocol };
  }

  if (entry && typeof entry === 'object') {
    const record = entry as {
      published?: number | string;
      target?: number | string;
      protocol?: string;
    };

    return {
      published: toPortNumber(record.published),
      target: toPortNumber(record.target),
      protocol: record.protocol === 'udp' ? 'udp' : 'tcp',
    };
  }

  return null;
};

const COMPOSE_VARIABLE_PATTERN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}/g;

export const resolveComposeVariables = (
  content: string,
  variables: Record<string, string>,
): string =>
  content.replace(
    COMPOSE_VARIABLE_PATTERN,
    (match, key: string | undefined, operator: string | undefined, fallback: string) => {
      if (key === undefined) {
        return match;
      }

      const value = variables[key];

      if (operator === undefined) {
        return value ?? match;
      }

      if (value === undefined || (operator === ':-' && value === '')) {
        return fallback;
      }

      return value;
    },
  );

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

const memoryLimitOf = (definition: unknown): string | undefined => {
  if (!definition || typeof definition !== 'object') {
    return undefined;
  }

  const deploy = (definition as { deploy?: { resources?: { limits?: { memory?: unknown } } } })
    .deploy;

  const memory = deploy?.resources?.limits?.memory;

  return memory === undefined || memory === null ? undefined : String(memory);
};

const MEMORY_LIMIT_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|k|m|g|kb|mb|gb)?$/i;

const MEMORY_LIMIT_UNITS: Record<string, number> = {
  b: 1 / (1024 * 1024),
  k: 1 / 1024,
  kb: 1 / 1024,
  m: 1,
  mb: 1,
  g: 1024,
  gb: 1024,
};

export const memoryLimitToMb = (value: string | undefined): number | undefined => {
  const match = value?.trim().match(MEMORY_LIMIT_PATTERN);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]) * MEMORY_LIMIT_UNITS[(match[2] ?? 'b').toLowerCase()]!;

  return amount > 0 ? Math.round(amount) : undefined;
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
      memoryLimit: memoryLimitOf(definition),
      raw: (definition && typeof definition === 'object' ? definition : {}) as Record<
        string,
        unknown
      >,
    })),
  };
};

export const parseComposeWithVariables = (
  content: string,
  variables: Record<string, string>,
): ParsedCompose => parseComposeDocument(resolveComposeVariables(content, variables));

export const findComposeService = (parsed: ParsedCompose, name: string) =>
  parsed.services.find(service => service.name === name);

export const publishedPortsOf = (parsed: ParsedCompose): number[] => [
  ...new Set(
    parsed.services
      .flatMap(service => service.ports.map(port => port.published))
      .filter((port): port is number => typeof port === 'number'),
  ),
];

export const publishedPortMappingsOf = (parsed: ParsedCompose): PublishedPortMapping[] =>
  parsed.services.flatMap(service =>
    service.ports.filter(
      (port): port is PublishedPortMapping =>
        typeof port.published === 'number' && typeof port.target === 'number',
    ),
  );

export const hostPortBindingsOf = (
  parsed: ParsedCompose,
): { port: number; protocol: 'tcp' | 'udp' }[] =>
  publishedPortMappingsOf(parsed).map(mapping => ({
    port: mapping.published,
    protocol: mapping.protocol,
  }));

export const applicationPortMappingsOf = (parsed: ParsedCompose): ApplicationPortMapping[] =>
  publishedPortMappingsOf(parsed).map(mapping => ({
    hostPort: mapping.published,
    containerPort: mapping.target,
    protocol: mapping.protocol,
  }));

const parseVolumeEntry = (
  entry: unknown,
): { name: string; target: string; readOnly: boolean } | null => {
  if (typeof entry === 'string') {
    const [source, target, mode] = entry.split(':');

    return source && target ? { name: source, target, readOnly: mode === 'ro' } : null;
  }

  if (entry && typeof entry === 'object') {
    const record = entry as {
      type?: string;
      source?: string;
      target?: string;
      read_only?: boolean;
    };

    if ((record.type && record.type !== 'volume') || !record.source || !record.target) {
      return null;
    }

    return { name: record.source, target: record.target, readOnly: Boolean(record.read_only) };
  }

  return null;
};

export const namedVolumesOf = (
  parsed: ParsedCompose,
): { name: string; target: string; readOnly: boolean }[] => {
  const byName = new Map<string, { name: string; target: string; readOnly: boolean }>();

  for (const service of parsed.services) {
    const volumes = service.raw.volumes;

    if (!Array.isArray(volumes)) {
      continue;
    }

    for (const entry of volumes) {
      const volume = parseVolumeEntry(entry);

      if (volume) {
        byName.set(volume.name, volume);
      }
    }
  }

  return [...byName.values()];
};

export const applicationVolumesOf = (
  parsed: ParsedCompose,
  projectName: string,
): ApplicationVolume[] =>
  namedVolumesOf(parsed).map(volume => ({
    source: `${projectName}_${volume.name}`,
    target: volume.target,
    readOnly: volume.readOnly,
  }));

export const renderEnvFile = (application: Application): string =>
  decryptVariables(application.variables)
    .map(variable => `${variable.key}=${variable.value}`)
    .join('\n');

export const secretValuesOf = (application: Application): string[] =>
  application.variables
    .filter(variable => variable.secret)
    .flatMap(variable => {
      try {
        const value = decryptSecret(variable.value);

        return value.length > 0 ? [value] : [];
      } catch {
        return [];
      }
    });

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

export type ApplicationReachabilityEntry = {
  hostPort: number;
  protocol: 'tcp' | 'udp';
  reachable: boolean;
  latencyMs?: number;
  error?: string;
};

export const fetchApplicationReachability = async (
  application: Application,
): Promise<{ mappings: ApplicationReachabilityEntry[]; degraded?: { reason: string } }> => {
  const portMappings = application.portMappings ?? [];

  if (portMappings.length === 0) {
    return { mappings: [] };
  }

  const server = await findServerById(String(application.serverId));

  if (!server?.agent.token) {
    return { mappings: [], degraded: { reason: 'This server has no agent yet' } };
  }

  try {
    const containers = resolveContainerProvider(buildAgentConnection(server));
    const containerId =
      application.source === 'compose' && application.compose
        ? composeContainerNameOf(application.slug, application.compose.expose.service)
        : containerNameOf(application.slug);

    const mappings = await Promise.all(
      portMappings.map(async mapping => {
        try {
          const result = await containers.checkReachability(
            containerId,
            mapping.hostPort,
            mapping.protocol,
          );

          return { hostPort: mapping.hostPort, protocol: mapping.protocol, ...result };
        } catch (error) {
          return {
            hostPort: mapping.hostPort,
            protocol: mapping.protocol,
            reachable: false,
            error: errorMessage(error),
          };
        }
      }),
    );

    return { mappings };
  } catch (error) {
    return { mappings: [], degraded: { reason: errorMessage(error) } };
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
