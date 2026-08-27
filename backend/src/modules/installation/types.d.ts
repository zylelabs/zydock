interface InstallationReplicaSource {
  host?: string;
  publicIp?: string;
  version?: string;
  snapshotAt?: Date;
}

interface InstallationData {
  role: import('./installation.schema').InstallationRole;
  standbySince?: Date;
  promotedAt?: Date;
  demotedAt?: Date;
  dataFrom?: Date;
  replicaOf?: InstallationReplicaSource;
  lastSnapshotAt?: Date;
  lastRestoreRunId?: string;
  note?: string;
}

type Installation = BaseDocument<InstallationData>;

interface InstallationSnapshotData {
  storageKey: string;
  sizeBytes?: number;
  includesApplicationData: boolean;
  version?: string;
  commit?: string;
  status: import('./snapshot.schema').SnapshotStatus;
  error?: string;
  finishedAt?: Date;
  durationMs?: number;
  createdBy?: string;
}

type InstallationSnapshot = BaseDocument<InstallationSnapshotData>;
