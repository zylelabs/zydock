import type { ContainerProvider } from '../../providers/container/container.contract';

export const PROTECTED_RESOURCE_MESSAGE =
  'This resource is part of the Zydock platform and cannot be stopped or removed.';

export const PROTECTED_RESOURCE_STATUS = 423;

export type ProtectableResourceKind = 'container' | 'volume' | 'network';

export const isResourceProtected = async (
  runtime: ContainerProvider,
  kind: ProtectableResourceKind,
  id: string,
): Promise<boolean> => {
  if (kind === 'container') {
    const container = await runtime.inspectContainer(id);

    return container?.protected ?? false;
  }

  const resources = kind === 'volume' ? await runtime.listVolumes() : await runtime.listNetworks();

  return resources.find(resource => resource.name === id)?.protected ?? false;
};
