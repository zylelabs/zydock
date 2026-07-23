import type { Paginated } from '~/composables/use-api';

export const BACKUP_TYPES = ['volume', 'database', 'configuration'] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];

export type BackupStatus = 'running' | 'completed' | 'failed';

export interface Backup {
  id: string;
  organizationId: string;
  type: BackupType;
  status: BackupStatus;
  label: string;
  serverId?: string;
  databaseId?: string;
  applicationId?: string;
  volumeName?: string;
  engine?: string;
  fileName: string;
  sizeBytes?: number;
  error?: string;
  finishedAt?: string;
  durationMs?: number;
  restoreStatus?: BackupStatus;
  restoreError?: string;
  lastRestoredAt?: string;
  createdAt: string;
}

export type CreateBackupBody =
  | { type: 'database'; databaseId: string }
  | { type: 'volume'; serverId: string; volumeName: string; applicationId?: string }
  | { type: 'configuration' };

export interface BackupFilter {
  type?: BackupType;
  status?: BackupStatus;
  databaseId?: string;
  serverId?: string;
}

export const useBackups = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/backups`;

  const list = (filter: BackupFilter = {}) =>
    api.get<Paginated<Backup>>(base(), { query: { size: 100, ...filter } });
  const create = (body: CreateBackupBody) => api.post<{ backup: Backup }>(base(), { body });
  const download = (backupId: string) => api.get<Blob>(`${base()}/${backupId}/download`);
  const restore = (backupId: string) =>
    api.post<{ backup: Backup }>(`${base()}/${backupId}/restore`);
  const remove = (backupId: string) => api.del<{ message: string }>(`${base()}/${backupId}`);

  return { list, create, download, restore, remove };
};
