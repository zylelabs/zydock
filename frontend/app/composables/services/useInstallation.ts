export const INSTALLATION_ROLES = ['active', 'standby'] as const;

export type InstallationRole = (typeof INSTALLATION_ROLES)[number];

export interface InstallationReplicaSource {
  host: string;
  publicIp: string;
  version: string;
  snapshotAt?: string;
}

export interface InstallationState {
  role: InstallationRole;
  standbySince?: string;
  promotedAt?: string;
  demotedAt?: string;
  dataFrom?: string;
  replicaOf?: InstallationReplicaSource;
  lastSnapshotAt?: string;
  note: string;
}

export interface RoleChangePayload {
  force?: boolean;
  note?: string;
}

export const SNAPSHOT_STATUSES = ['running', 'completed', 'failed'] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const SNAPSHOT_ORIGINS = ['generated', 'uploaded'] as const;

export type SnapshotOrigin = (typeof SNAPSHOT_ORIGINS)[number];

export interface InstallationSnapshot {
  id: string;
  status: SnapshotStatus;
  origin: SnapshotOrigin;
  originalFileName?: string;
  includesApplicationData: boolean;
  version?: string;
  commit?: string;
  sizeBytes?: number;
  error?: string;
  finishedAt?: string;
  durationMs?: number;
  fileName: string;
  createdAt: string;
}

export interface CreateSnapshotPayload {
  passphrase: string;
  includeApplicationData?: boolean;
}

export const RESTORE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type RestoreRunStatus = (typeof RESTORE_RUN_STATUSES)[number];

export interface RestoreRun {
  id: string;
  status: RestoreRunStatus;
  bundlePath: string;
  installPath: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  exitCode: number;
  log: string;
}

export interface StartRestorePayload {
  bundlePath: string;
  passphrase: string;
}

export interface DnsChecklistEntry {
  kind: 'dashboard' | 'application';
  domain: string;
  pointsToOldIp: boolean;
}

export const STANDBY_STALE_DAYS = 30;

export const daysSince = (date?: string) => {
  if (!date) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));
};

export const restoreCommandOf = (fileName: string, passphrase: string) =>
  `ZYDOCK_RESTORE=./${fileName} ZYDOCK_RESTORE_PASSPHRASE='${passphrase}' bash install.sh`;

export const useInstallation = () => {
  const api = useApi();
  const session = useSessionStore();

  const getStatus = () => api.get<InstallationState>('/installation');

  const demote = (payload: RoleChangePayload = {}) =>
    api.post<InstallationState>('/installation/demote', { body: payload });

  const promote = (payload: RoleChangePayload = {}) =>
    api.post<InstallationState>('/installation/promote', { body: payload });

  const dnsChecklist = () =>
    api.get<{ domains: DnsChecklistEntry[] }>('/installation/dns-checklist');

  const listSnapshots = () =>
    api.get<{ snapshots: InstallationSnapshot[] }>('/installation/snapshots');

  const createSnapshot = (payload: CreateSnapshotPayload) =>
    api.post<{ snapshot: InstallationSnapshot }>('/installation/snapshots', { body: payload });

  const removeSnapshot = (snapshotId: string) =>
    api.del<{ message: string }>(`/installation/snapshots/${snapshotId}`);

  const downloadSnapshot = (snapshotId: string) =>
    api.get<Blob>(`/installation/snapshots/${snapshotId}/download`);

  const startRestore = (payload: StartRestorePayload) =>
    api.post<RestoreRun>('/installation/restore', { body: payload });

  const restoreSnapshot = (snapshotId: string, passphrase: string) =>
    api.post<RestoreRun>(`/installation/snapshots/${snapshotId}/restore`, {
      body: { passphrase },
    });

  const getRestoreRun = () => api.get<RestoreRun>('/installation/restore');

  const uploadSnapshot = (file: File, onProgress?: (percent: number) => void) =>
    new Promise<InstallationSnapshot>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const query = new URLSearchParams({ fileName: file.name });

      xhr.open('POST', `/api/proxy/installation/snapshots/upload?${query.toString()}`);

      if (session.accessToken) {
        xhr.setRequestHeader('authorization', `Bearer ${session.accessToken}`);
      }

      xhr.upload.onprogress = event => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve((JSON.parse(xhr.responseText) as { snapshot: InstallationSnapshot }).snapshot);
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed'));

      xhr.send(file);
    });

  return {
    getStatus,
    demote,
    promote,
    dnsChecklist,
    listSnapshots,
    createSnapshot,
    removeSnapshot,
    downloadSnapshot,
    startRestore,
    restoreSnapshot,
    getRestoreRun,
    uploadSnapshot,
  };
};
