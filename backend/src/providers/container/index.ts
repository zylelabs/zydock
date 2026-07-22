import config from '../../config';
import {
  CONTAINER_RUNTIMES,
  type ContainerConnection,
  type ContainerProvider,
  type ContainerProviderFactory,
  type ContainerRuntime,
} from './container.contract';

const factories: Partial<Record<ContainerRuntime, ContainerProviderFactory>> = {};

const isContainerRuntime = (value: string): value is ContainerRuntime =>
  CONTAINER_RUNTIMES.some(runtime => runtime === value);

export const resolveContainerProvider = (connection: ContainerConnection): ContainerProvider => {
  const runtime = connection.runtime ?? config.providers.container.runtime;

  if (!isContainerRuntime(runtime)) {
    throw new Error(`Unknown container runtime "${runtime}"`);
  }

  const factory = factories[runtime];

  if (!factory) {
    throw new Error(`Container runtime "${runtime}" has no registered implementation`);
  }

  return factory({ ...connection, runtime });
};

export type * from './container.contract';
