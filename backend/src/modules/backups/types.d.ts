interface BackupData {
  organizationId: string;
  type: import('./backup.schema').BackupType;
  status: import('./backup.schema').BackupStatus;
  serverId?: string;
  databaseId?: string;
  applicationId?: string;
  volumeName?: string;
  engine?: string;
  /** What was backed up, in words — the database or volume name, or the organization. */
  label: string;
  storageKey: string;
  sizeBytes?: number;
  error?: string;
  finishedAt?: Date;
  durationMs?: number;
  restoreStatus?: import('./backup.schema').BackupStatus;
  restoreError?: string;
  lastRestoredAt?: Date;
  createdBy?: string;
}

type Backup = BaseDocument<BackupData>;
