import { parse } from 'yaml';
import { resolveComposeProvider } from '../../providers/compose';
import { escapeRegex } from '../../utils';
import { decryptVariables } from '../applications/application.service';
import { composeContainerNameOf, composeProjectOf } from '../deployments/naming';
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
};

export const listApplicationServices = (application: Application): ApplicationServiceSummary[] => {
  if (application.source !== 'compose' || !application.compose) {
    return [];
  }

  try {
    const parsed = parseComposeDocument(application.compose.content);

    return parsed.services.map(service => ({
      service: service.name,
      containerName: composeContainerNameOf(application.slug, service.name),
      exposed: service.name === application.compose!.expose.service,
    }));
  } catch {
    return [];
  }
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
