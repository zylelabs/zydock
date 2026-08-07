import { createRemoteUpdaterProvider } from './remote.provider';
import type { UpdaterConnection, UpdaterProvider } from './updater.contract';

export const resolveUpdaterProvider = (connection: UpdaterConnection): UpdaterProvider =>
  createRemoteUpdaterProvider(connection);

export type * from './updater.contract';
