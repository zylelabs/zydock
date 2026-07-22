import config from '../../config';
import { createSsh2Provider } from './ssh2.provider';
import {
  SSH_IMPLEMENTATIONS,
  type SshImplementation,
  type SshProvider,
  type SshProviderFactory,
} from './ssh.contract';

const factories: Partial<Record<SshImplementation, SshProviderFactory>> = {
  ssh2: createSsh2Provider,
};

const isSshImplementation = (value: string): value is SshImplementation =>
  SSH_IMPLEMENTATIONS.some(implementation => implementation === value);

export const resolveSshProvider = (): SshProvider => {
  const implementation = config.providers.ssh.implementation;

  if (!isSshImplementation(implementation)) {
    throw new Error(`Unknown SSH provider "${implementation}"`);
  }

  const factory = factories[implementation];

  if (!factory) {
    throw new Error(`SSH provider "${implementation}" has no registered implementation`);
  }

  return factory();
};

export type * from './ssh.contract';
