import { createDockerProvider } from './docker.provider';
import type { ContainerProvider } from './container.contract';

const containers = createDockerProvider();

export const resolveContainerProvider = (): ContainerProvider => containers;

export type * from './container.contract';
