import type { Paginated } from '~/composables/use-api';

export type ApplicationStatus = 'created' | 'deploying' | 'running' | 'stopped' | 'failed';

export type GitHost = 'github';

export interface ApplicationGit {
  host: GitHost;
  repository: string;
  branch: string;
  dockerfilePath: string;
  buildContext: string;
  autoDeploy: boolean;
  hasToken?: boolean;
  token?: string;
  hasWebhook?: boolean;
  /** The delivery URL the git host calls — not a secret, only present once a webhook is configured. */
  webhookUrl?: string;
}

export interface GitWebhook {
  id: string;
  url: string;
  events: string[];
}

export interface ApplicationVariable {
  key: string;
  value?: string;
  secret: boolean;
}

export interface ApplicationPortMapping {
  hostPort: number;
  containerPort: number;
  protocol: 'tcp' | 'udp';
}

export interface ApplicationVolume {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface ApplicationHealthcheck {
  path: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds?: number;
}

export interface ApplicationResources {
  cpus?: number;
  memoryMb?: number;
}

export interface Application {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  serverId: string;
  name: string;
  slug: string;
  status: ApplicationStatus;
  git: ApplicationGit;
  port: number;
  portMappings: ApplicationPortMapping[];
  variables: ApplicationVariable[];
  volumes: ApplicationVolume[];
  networks: string[];
  healthcheck?: ApplicationHealthcheck;
  resources?: ApplicationResources;
  restartPolicy: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplicationBody {
  name: string;
  environmentId: string;
  serverId: string;
  git: Partial<ApplicationGit> & { repository: string };
  port: number;
}

export type ApplicationFilter = {
  projectId?: string;
  environmentId?: string;
  serverId?: string;
};

export const useApplications = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/applications`;

  const list = (filter: ApplicationFilter = {}) =>
    api.get<Paginated<Application>>(base(), { query: { size: 100, ...filter } });
  const get = (applicationId: string) =>
    api.get<{ application: Application }>(`${base()}/${applicationId}`);
  const create = (body: CreateApplicationBody) =>
    api.post<{ application: Application }>(base(), { body });
  const update = (applicationId: string, body: Record<string, unknown>) =>
    api.patch<{ application: Application }>(`${base()}/${applicationId}`, { body });
  const remove = (applicationId: string) =>
    api.del<{ message: string }>(`${base()}/${applicationId}`);

  const listVariables = (applicationId: string) =>
    api.get<{ variables: ApplicationVariable[] }>(`${base()}/${applicationId}/variables`);
  const replaceVariables = (applicationId: string, variables: ApplicationVariable[]) =>
    api.put<{ variables: ApplicationVariable[] }>(`${base()}/${applicationId}/variables`, {
      body: { variables },
    });

  const deploy = (applicationId: string, body: { branch?: string; commit?: string } = {}) =>
    api.post<{ deployment: { id: string } }>(`${base()}/${applicationId}/deploy`, { body });

  const rollback = (applicationId: string, deploymentId: string) =>
    api.post<{ deployment: { id: string } }>(`${base()}/${applicationId}/rollback`, {
      body: { deploymentId },
    });

  const restart = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/restart`);
  const stop = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/stop`);
  const start = (applicationId: string) =>
    api.post<{ application: Application }>(`${base()}/${applicationId}/start`);

  const configureWebhook = (applicationId: string) =>
    api.post<{ webhook: GitWebhook }>(`${base()}/${applicationId}/webhook`);
  const removeWebhook = (applicationId: string) =>
    api.del<{ message: string }>(`${base()}/${applicationId}/webhook`);

  return {
    list,
    get,
    create,
    update,
    remove,
    listVariables,
    replaceVariables,
    deploy,
    rollback,
    restart,
    stop,
    start,
    configureWebhook,
    removeWebhook,
  };
};
