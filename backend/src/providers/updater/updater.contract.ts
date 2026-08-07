export const UPDATE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type UpdateRunStatus = (typeof UPDATE_RUN_STATUSES)[number];

export type UpdaterConnection = {
  serverId: string;
  endpoint: string;
  token: string;
};

export type UpdateRunSpec = {
  channel?: string;
  branch?: string;
  ref?: string;
  force?: boolean;
};

export type UpdateRun = {
  id: string;
  status: UpdateRunStatus;
  from: string;
  to: string;
  channel: string;
  installPath: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  exitCode: number;
};

export type UpdateRunDetail = UpdateRun & {
  log: string;
};

export type UpdaterProvider = {
  startRun: (spec: UpdateRunSpec) => Promise<UpdateRun>;
  getRun: (runId: string) => Promise<UpdateRunDetail | null>;
};

export type UpdaterProviderFactory = (connection: UpdaterConnection) => UpdaterProvider;
