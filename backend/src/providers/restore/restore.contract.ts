export const RESTORE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type RestoreRunStatus = (typeof RESTORE_RUN_STATUSES)[number];

export type RestoreConnection = {
  serverId: string;
  endpoint: string;
  token: string;
};

export type RestoreRunSpec = {
  bundlePath: string;
  passphrase: string;
};

export type RestoreRun = {
  id: string;
  status: RestoreRunStatus;
  bundlePath: string;
  installPath: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  exitCode: number;
};

export type RestoreRunDetail = RestoreRun & {
  log: string;
};

export type RestoreProvider = {
  startRun: (spec: RestoreRunSpec) => Promise<RestoreRun>;
  getRun: (runId: string) => Promise<RestoreRunDetail | null>;
};

export type RestoreProviderFactory = (connection: RestoreConnection) => RestoreProvider;
