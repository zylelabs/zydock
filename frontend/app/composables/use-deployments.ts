import type { Paginated } from '~/composables/use-api';
import type { LogEntry, LogFilters } from '~/composables/use-logs';

export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type DeploymentStepName = 'clone' | 'build' | 'container' | 'proxy' | 'healthcheck';

export type DeploymentStepStatus = 'ok' | 'failed' | 'skipped';

export interface DeploymentStep {
  step: DeploymentStepName;
  status: DeploymentStepStatus;
  detail?: string;
  durationMs?: number;
}

export interface Deployment {
  id: string;
  applicationId: string;
  serverId: string;
  status: DeploymentStatus;
  trigger: 'manual' | 'webhook';
  branch?: string;
  commit?: { sha: string; message?: string; author?: string };
  imageTag?: string;
  containerId?: string;
  steps: DeploymentStep[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
}

export interface DeploymentDetail extends Deployment {
  buildLog: string[];
}

export const useDeployments = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/deployments`;

  const list = (filter: { applicationId?: string; status?: DeploymentStatus } = {}) =>
    api.get<Paginated<Deployment>>(base(), { query: { size: 50, ...filter } });

  const get = (deploymentId: string) =>
    api.get<{ deployment: DeploymentDetail }>(`${base()}/${deploymentId}`);

  const logs = (deploymentId: string, filters: LogFilters = {}) =>
    api.get<{ entries: LogEntry[] }>(`${base()}/${deploymentId}/logs`, { query: { ...filters } });

  const downloadLogs = (deploymentId: string, filters: LogFilters = {}) =>
    api.get<string>(`${base()}/${deploymentId}/logs/download`, { query: { ...filters } });

  const topic = (deploymentId: string) => `deployment:${deploymentId}:steps`;

  return { list, get, logs, downloadLogs, topic };
};
