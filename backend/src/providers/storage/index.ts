import config from '../../config';
import {
  STORAGE_IMPLEMENTATIONS,
  type StorageImplementation,
  type StorageProvider,
  type StorageProviderFactory,
} from './storage.contract';
import { createLocalStorageProvider } from './local.provider';

const factories: Partial<Record<StorageImplementation, StorageProviderFactory>> = {
  local: createLocalStorageProvider,
};

const isStorageImplementation = (value: string): value is StorageImplementation =>
  STORAGE_IMPLEMENTATIONS.some(implementation => implementation === value);

export const resolveStorageProvider = (): StorageProvider => {
  const implementation = config.providers.storage.implementation;

  if (!isStorageImplementation(implementation)) {
    throw new Error(`Unknown storage provider "${implementation}"`);
  }

  const factory = factories[implementation];

  if (!factory) {
    throw new Error(`Storage provider "${implementation}" has no registered implementation`);
  }

  return factory();
};

export type * from './storage.contract';
