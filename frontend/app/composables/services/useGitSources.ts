import type { Paginated } from '../useApi';

export type GitSourceStatus = 'pending' | 'active';

export interface GitSource {
  id: string;
  organizationId: string;
  name: string;
  status: GitSourceStatus;
  appId?: string;
  slug?: string;
  htmlUrl?: string;
  clientId?: string;
  createdAt: string;
}

export interface GitInstallation {
  id: string;
  account: string;
  accountType: string;
  repositorySelection: string;
  htmlUrl: string;
}

export interface GitRepository {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
}

export interface StartManifestResult {
  gitSource: GitSource;
  state: string;
  manifest: Record<string, unknown>;
  postUrl: string;
}

export const useGitSources = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/git-sources`;

  const list = () => api.get<Paginated<GitSource>>(base(), { query: { size: 100 } });
  const get = (gitSourceId: string) =>
    api.get<{ gitSource: GitSource }>(`${base()}/${gitSourceId}`);

  const startManifest = (body: { name: string; organization?: string }) =>
    api.post<StartManifestResult>(`${base()}/manifest`, { body });
  const completeManifest = (body: { code: string; state: string }) =>
    api.post<{ gitSource: GitSource }>(`${base()}/callback`, { body });

  const listInstallations = (gitSourceId: string) =>
    api.get<{ items: GitInstallation[] }>(`${base()}/${gitSourceId}/installations`);
  const listRepositories = (gitSourceId: string, installationId: string) =>
    api.get<{ items: GitRepository[] }>(
      `${base()}/${gitSourceId}/installations/${installationId}/repositories`,
    );

  const remove = (gitSourceId: string) => api.del<{ message: string }>(`${base()}/${gitSourceId}`);

  return {
    list,
    get,
    startManifest,
    completeManifest,
    listInstallations,
    listRepositories,
    remove,
  };
};
