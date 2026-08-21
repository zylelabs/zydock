import config from '../../config';
import { createOpensslTlsProvider } from './openssl.provider';
import {
  TLS_IMPLEMENTATIONS,
  type TlsImplementation,
  type TlsProvider,
  type TlsProviderFactory,
} from './tls.contract';

const factories: Partial<Record<TlsImplementation, TlsProviderFactory>> = {
  openssl: createOpensslTlsProvider,
};

const isTlsImplementation = (value: string): value is TlsImplementation =>
  TLS_IMPLEMENTATIONS.some(implementation => implementation === value);

export const resolveTlsProvider = (): TlsProvider => {
  const implementation = config.providers.tls.implementation;

  if (!isTlsImplementation(implementation)) {
    throw new Error(`Unknown TLS provider "${implementation}"`);
  }

  const factory = factories[implementation];

  if (!factory) {
    throw new Error(`TLS provider "${implementation}" has no registered implementation`);
  }

  return factory();
};

export type * from './tls.contract';
