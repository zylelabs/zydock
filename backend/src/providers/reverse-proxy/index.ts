import config from '../../config';
import {
  REVERSE_PROXY_IMPLEMENTATIONS,
  type ReverseProxyConnection,
  type ReverseProxyImplementation,
  type ReverseProxyProvider,
  type ReverseProxyProviderFactory,
} from './reverse-proxy.contract';

const factories: Partial<Record<ReverseProxyImplementation, ReverseProxyProviderFactory>> = {};

const isReverseProxyImplementation = (value: string): value is ReverseProxyImplementation =>
  REVERSE_PROXY_IMPLEMENTATIONS.some(implementation => implementation === value);

export const resolveReverseProxyProvider = (
  connection: ReverseProxyConnection,
): ReverseProxyProvider => {
  const implementation = connection.implementation ?? config.providers.reverseProxy.implementation;

  if (!isReverseProxyImplementation(implementation)) {
    throw new Error(`Unknown reverse proxy "${implementation}"`);
  }

  const factory = factories[implementation];

  if (!factory) {
    throw new Error(`Reverse proxy "${implementation}" has no registered implementation`);
  }

  return factory({ ...connection, implementation });
};

export type * from './reverse-proxy.contract';
