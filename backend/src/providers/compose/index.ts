import config from '../../config';
import { CONTAINER_RUNTIMES, type ContainerRuntime } from '../container/container.contract';
import type {
  ComposeConnection,
  ComposeProvider,
  ComposeProviderFactory,
} from './compose.contract';
import { createRemoteComposeProvider } from './remote.provider';

const factories: Partial<Record<ContainerRuntime, ComposeProviderFactory>> = {
  docker: createRemoteComposeProvider,
};

const isContainerRuntime = (value: string): value is ContainerRuntime =>
  CONTAINER_RUNTIMES.some(runtime => runtime === value);

export const resolveComposeProvider = (connection: ComposeConnection): ComposeProvider => {
  const runtime = connection.runtime ?? config.providers.container.runtime;

  if (!isContainerRuntime(runtime)) {
    throw new Error(`Unknown container runtime "${runtime}"`);
  }

  const factory = factories[runtime];

  if (!factory) {
    throw new Error(`Container runtime "${runtime}" has no registered Compose implementation`);
  }

  return factory({ ...connection, runtime });
};

export type * from './compose.contract';
