import { createRemoteRestoreProvider } from './remote.provider';
import type { RestoreConnection, RestoreProvider } from './restore.contract';

export const resolveRestoreProvider = (connection: RestoreConnection): RestoreProvider =>
  createRemoteRestoreProvider(connection);

export type * from './restore.contract';
