export const UPDATE_CHANNELS = ['stable', 'nightly', 'dev', 'branch'] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const UPDATE_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;

export type UpdateFrequency = (typeof UPDATE_FREQUENCIES)[number];

export type UpdateCheckSource = 'manual' | 'automatic';

export interface UpdateSettings {
  channel: UpdateChannel;
  branch: string;
  auto: boolean;
  frequency: UpdateFrequency;
}

export type UpdateSettingsPatch = Partial<UpdateSettings>;

export interface UpdateStatus extends UpdateSettings {
  installed: { version: string; commit: string; channel: string };
  remote: { ref: string; version: string; commit: string };
  updateAvailable: boolean;
  nextCheckAt?: string;
  lastRunId?: string;
  lastCheckedAt?: string;
  lastCheckSource?: UpdateCheckSource;
  lastCheckError?: string;
}

export const UPDATE_RUN_STATUSES = ['running', 'success', 'failed', 'unknown'] as const;

export type UpdateRunStatus = (typeof UPDATE_RUN_STATUSES)[number];

export interface UpdateRun {
  id: string;
  status: UpdateRunStatus;
  from: string;
  to: string;
  channel: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  exitCode: number;
  log: string;
  rollbackCommand: string;
}

export type UpdateRunPhase = 'idle' | 'updating' | 'succeeded' | 'failed' | 'unknown';

export const updateRunPhase = (run: UpdateRun | null, isPolling: boolean): UpdateRunPhase => {
  if (!run) {
    return isPolling ? 'updating' : 'idle';
  }

  if (run.status === 'running') {
    return 'updating';
  }

  if (run.status === 'success') {
    return 'succeeded';
  }

  if (run.status === 'failed') {
    return 'failed';
  }

  return 'unknown';
};

const UPDATE_CELEBRATION_KEY = 'updates:celebrate';

export const markUpdateCelebration = () =>
  window.sessionStorage.setItem(UPDATE_CELEBRATION_KEY, '1');

export const consumeUpdateCelebration = () => {
  const pending = window.sessionStorage.getItem(UPDATE_CELEBRATION_KEY) === '1';

  window.sessionStorage.removeItem(UPDATE_CELEBRATION_KEY);

  return pending;
};

export const isChannelDowngrade = (from: UpdateChannel, to: UpdateChannel) =>
  to === 'stable' && from !== 'stable';

export const useUpdates = () => {
  const api = useApi();

  const getStatus = () => api.get<UpdateStatus>('/updates/status');

  const updateSettings = (patch: UpdateSettingsPatch) =>
    api.patch<UpdateSettings>('/updates/settings', { body: patch });

  const check = () => api.post<UpdateStatus>('/updates/check');

  const run = (force = false) => api.post<UpdateRun>('/updates/run', { body: { force } });

  const getRun = (runId: string) => api.get<UpdateRun>(`/updates/runs/${runId}`);

  return { getStatus, updateSettings, check, run, getRun };
};
