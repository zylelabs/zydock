import type { Paginated } from '../useApi';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export const useProjects = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/projects`;

  const list = () => api.get<Paginated<Project>>(base(), { query: { size: 100 } });
  const get = (projectId: string) => api.get<{ project: Project }>(`${base()}/${projectId}`);
  const create = (name: string, description?: string) =>
    api.post<{ project: Project }>(base(), { body: { name, description } });
  const update = (projectId: string, body: { name?: string; description?: string }) =>
    api.patch<{ project: Project }>(`${base()}/${projectId}`, { body });
  const remove = (projectId: string) => api.del<{ message: string }>(`${base()}/${projectId}`);

  const listEnvironments = (projectId: string) =>
    api.get<Paginated<Environment>>(`${base()}/${projectId}/environments`, {
      query: { size: 100 },
    });
  const createEnvironment = (projectId: string, name: string) =>
    api.post<{ environment: Environment }>(`${base()}/${projectId}/environments`, {
      body: { name },
    });
  const updateEnvironment = (projectId: string, environmentId: string, name: string) =>
    api.patch<{ environment: Environment }>(
      `${base()}/${projectId}/environments/${environmentId}`,
      { body: { name } },
    );
  const removeEnvironment = (projectId: string, environmentId: string) =>
    api.del<{ message: string }>(`${base()}/${projectId}/environments/${environmentId}`);

  return {
    list,
    get,
    create,
    update,
    remove,
    listEnvironments,
    createEnvironment,
    updateEnvironment,
    removeEnvironment,
  };
};
