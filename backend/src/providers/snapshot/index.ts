import { createRemoteSnapshotProvider } from './remote.provider';
import type { SnapshotConnection, SnapshotProvider } from './snapshot.contract';

export const resolveSnapshotProvider = (connection: SnapshotConnection): SnapshotProvider =>
  createRemoteSnapshotProvider(connection);

export type * from './snapshot.contract';
