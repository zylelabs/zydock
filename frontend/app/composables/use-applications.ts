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
}

export interface ApplicationVariable {
  key: string;
  value?: string;
  secret: boolean;
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
  variables: ApplicationVariable[];
  volumes: { source: string; target: string; readOnly?: boolean }[];
  networks: string[];
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

  return { list, get, create, update, remove, listVariables, replaceVariables, deploy };
};
