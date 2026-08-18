import { z } from 'zod';
import config from '../../config';

export const MAX_COMPOSE_FILE_BYTES = 1_000_000;

export const applicationComposeExposeSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid service name'),
  port: z.coerce.number().int().min(1).max(65535),
  kind: z.enum(['http', 'tcp', 'udp']).default('http'),
});

export type ApplicationComposeExposeDTO = z.infer<typeof applicationComposeExposeSchema>;

export const applicationComposeSchema = z.object({
  content: z.string().trim().min(1).max(MAX_COMPOSE_FILE_BYTES),
  expose: applicationComposeExposeSchema,
});

export type ApplicationComposeDTO = z.infer<typeof applicationComposeSchema>;

const FORBIDDEN_SERVICE_KEYS = [
  'privileged',
  'cap_add',
  'devices',
  'security_opt',
  'userns_mode',
  'build',
] as const;

const HOST_NAMESPACE_KEYS = ['network_mode', 'pid', 'ipc'] as const;

const isDenylistedValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
};

const isHostBindMountSource = (source: string) =>
  source.startsWith('/') ||
  source.startsWith('./') ||
  source.startsWith('../') ||
  source === '~' ||
  source.startsWith('~/');

const assertVolumesAreSafe = (name: string, raw: Record<string, unknown>) => {
  const volumes = raw.volumes;

  if (!Array.isArray(volumes)) {
    return;
  }

  for (const entry of volumes) {
    if (typeof entry === 'string') {
      const [source] = entry.split(':');

      if (source && isHostBindMountSource(source)) {
        throw new Error(
          `Service "${name}": bind-mounting a host path ("${source}") is not allowed`,
        );
      }

      continue;
    }

    if (entry && typeof entry === 'object') {
      const volume = entry as { type?: string; source?: string };

      if (volume.type === 'bind' || (volume.source && isHostBindMountSource(volume.source))) {
        throw new Error(
          `Service "${name}": bind-mounting a host path ("${volume.source ?? ''}") is not allowed`,
        );
      }
    }
  }
};

const REGISTRY_HOST_PATTERN = /[.:]|^localhost$/;

export const registryReferenceOf = (repository: string): { host: string; path: string } => {
  const slashIndex = repository.indexOf('/');

  if (slashIndex === -1) {
    return { host: 'docker.io', path: repository };
  }

  const firstSegment = repository.slice(0, slashIndex);

  if (REGISTRY_HOST_PATTERN.test(firstSegment)) {
    return { host: firstSegment, path: repository.slice(slashIndex + 1) };
  }

  return { host: 'docker.io', path: repository };
};

const parseImageReference = (image: string) => {
  let rest = image.trim();
  let digest: string | undefined;

  const atIndex = rest.lastIndexOf('@');

  if (atIndex !== -1) {
    digest = rest.slice(atIndex + 1);
    rest = rest.slice(0, atIndex);
  }

  const slashIndex = rest.indexOf('/');
  let registry = 'docker.io';
  let remainder = rest;

  if (slashIndex !== -1) {
    const firstSegment = rest.slice(0, slashIndex);

    if (REGISTRY_HOST_PATTERN.test(firstSegment)) {
      registry = firstSegment;
      remainder = rest.slice(slashIndex + 1);
    }
  }

  const lastSlash = remainder.lastIndexOf('/');
  const lastSegment = lastSlash === -1 ? remainder : remainder.slice(lastSlash + 1);
  const colonIndex = lastSegment.lastIndexOf(':');
  const tag = colonIndex === -1 ? undefined : lastSegment.slice(colonIndex + 1);

  return { registry, tag, digest };
};

const assertImageIsSafe = (name: string, image: string | undefined) => {
  if (!image) {
    throw new Error(`Service "${name}": an "image" is required`);
  }

  const { registry, tag, digest } = parseImageReference(image);

  if (!digest && (!tag || tag === 'latest')) {
    throw new Error(
      `Service "${name}": image "${image}" must use an immutable tag or a digest, "latest" is not allowed`,
    );
  }

  if (!config.compose.registryAllowlist.includes(registry)) {
    throw new Error(
      `Service "${name}": registry "${registry}" is not in the allowed list (${config.compose.registryAllowlist.join(', ')})`,
    );
  }
};

export const validateComposeSecurity = (parsed: ParsedCompose): void => {
  if (parsed.services.length > config.compose.maxServices) {
    throw new Error(
      `The compose file declares ${parsed.services.length} services, more than the limit of ${config.compose.maxServices}`,
    );
  }

  for (const service of parsed.services) {
    for (const key of FORBIDDEN_SERVICE_KEYS) {
      if (isDenylistedValue(service.raw[key])) {
        throw new Error(`Service "${service.name}": "${key}" is not allowed`);
      }
    }

    for (const key of HOST_NAMESPACE_KEYS) {
      if (service.raw[key] === 'host') {
        throw new Error(`Service "${service.name}": "${key}: host" is not allowed`);
      }
    }

    assertVolumesAreSafe(service.name, service.raw);
    assertImageIsSafe(service.name, service.image);
  }
};
