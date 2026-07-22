import config from '../../config';
import {
  DNS_IMPLEMENTATIONS,
  type DnsCredentials,
  type DnsImplementation,
  type DnsProvider,
  type DnsProviderFactory,
} from './dns.contract';

const factories: Partial<Record<DnsImplementation, DnsProviderFactory>> = {};

const isDnsImplementation = (value: string): value is DnsImplementation =>
  DNS_IMPLEMENTATIONS.some(implementation => implementation === value);

export const resolveDnsProvider = (credentials: DnsCredentials): DnsProvider => {
  const implementation = credentials.implementation ?? config.providers.dns.implementation;

  if (!isDnsImplementation(implementation)) {
    throw new Error(`Unknown DNS provider "${implementation}"`);
  }

  const factory = factories[implementation];

  if (!factory) {
    throw new Error(`DNS provider "${implementation}" has no registered implementation`);
  }

  return factory({ ...credentials, implementation });
};

export type * from './dns.contract';
