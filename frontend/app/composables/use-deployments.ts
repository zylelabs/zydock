import type { Paginated } from '~/composables/use-api';

export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface DeploymentStep {
  name: string;
  status: 'queued' | 'running' | 'ok' | 'failed' | 'skipped';
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

  return { list, get };
};
