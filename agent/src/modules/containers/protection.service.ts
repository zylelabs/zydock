import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import type { ContainerInfo } from '../../providers/container/container.contract';
import { logInfo } from '../../utils/logger';

export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

export const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

export const PROTECTED_LABEL = 'zydock.protected';

export const MANAGED_VOLUME_LABEL = 'zydock.managed';

export const PROTECTED_RESOURCE_MESSAGE =
  'This resource is part of the Zydock platform and cannot be stopped or removed.';

export const UNMANAGED_VOLUME_MESSAGE =
  'This volume was not created by Zydock and cannot be accessed through this API.';

export const PROTECTED_RESOURCE_STATUS = 423;

const STACK_SERVICES = ['mongo', 'backend', 'agent', 'frontend', 'caddy'];

export type ProtectedResourceKind = 'container' | 'volume' | 'network';

type ProtectedResourceFailure = Error & { statusCode?: number };

export const isProtectedResource = (labels: Record<string, string>): boolean => {
  if (labels[PROTECTED_LABEL] === 'true') {
    return true;
  }

  const project = labels[COMPOSE_PROJECT_LABEL];

  if (!project) {
    return false;
  }

  const service = labels[COMPOSE_SERVICE_LABEL];

  return service === undefined || STACK_SERVICES.includes(service);
};

const idFromCgroup = (): string | undefined => {
  try {
    const cgroup = readFileSync('/proc/self/cgroup', 'utf8');
    const match = cgroup.match(/[0-9a-f]{64}/);

    return match?.[0];
  } catch {
    return undefined;
  }
};

const idFromHostname = (): string | undefined => {
  const value = hostname();

  return /^[0-9a-f]{12}$/i.test(value) ? value : undefined;
};

let ownContainerId: string | undefined | null = null;

export const getOwnContainerId = (): string | undefined => {
  if (ownContainerId === null) {
    ownContainerId = idFromCgroup() ?? idFromHostname();
  }

  return ownContainerId;
};

export const resolveOwnContainer = () => {
  const id = getOwnContainerId();

  logInfo('Agent resolved its own container id', { containerId: id ?? 'unknown' });
};

const isOwnContainer = (id: string) => {
  const own = getOwnContainerId();

  if (!own) {
    return false;
  }

  return id === own || id.startsWith(own) || own.startsWith(id);
};

export const isProtectedContainer = (container: Pick<ContainerInfo, 'id' | 'labels'>): boolean =>
  isOwnContainer(container.id) || isProtectedResource(container.labels);

export const isManagedVolume = (labels: Record<string, string>): boolean =>
  labels[COMPOSE_PROJECT_LABEL] !== undefined ||
  labels[PROTECTED_LABEL] === 'true' ||
  labels[MANAGED_VOLUME_LABEL] === 'true';

const resourceError = (message: string): ProtectedResourceFailure => {
  const error: ProtectedResourceFailure = new Error(message);

  error.statusCode = PROTECTED_RESOURCE_STATUS;

  return error;
};

const protectedResourceError = (): ProtectedResourceFailure =>
  resourceError(PROTECTED_RESOURCE_MESSAGE);

export const protectedResourceStatus = (error: unknown): 423 | undefined => {
  const status =
    error instanceof Error ? (error as ProtectedResourceFailure).statusCode : undefined;

  return status === PROTECTED_RESOURCE_STATUS ? status : undefined;
};

export const assertManagedVolume = async (name: string) => {
  const containers = resolveContainerProvider();
  const volume = (await containers.listVolumes()).find(item => item.name === name);

  if (!volume) {
    throw new Error('Volume not found');
  }

  if (!isManagedVolume(volume.labels)) {
    throw resourceError(UNMANAGED_VOLUME_MESSAGE);
  }
};

export const assertUnprotected = async (kind: ProtectedResourceKind, id: string) => {
  if (config.allowSystemContainerRemoval) {
    return;
  }

  const containers = resolveContainerProvider();

  if (kind === 'container') {
    const inspect = await containers.inspectContainer(id);

    if (inspect && isProtectedContainer(inspect)) {
      throw protectedResourceError();
    }

    return;
  }

  const resources =
    kind === 'volume' ? await containers.listVolumes() : await containers.listNetworks();
  const resource = resources.find(item => item.name === id);

  if (resource && isProtectedResource(resource.labels)) {
    throw protectedResourceError();
  }
};
