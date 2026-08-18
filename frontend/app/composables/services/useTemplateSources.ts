import type { Paginated } from '../useApi';

export interface TemplateSourceCollision {
  templateId: string;
  sourceId: string;
  keptBy: string;
}

export interface TemplateSource {
  id: string;
  url: string;
  ref: string;
  enabled: boolean;
  lastSyncedAt?: string;
  lastError?: string;
  templateCount: number;
  collisions: TemplateSourceCollision[];
  createdAt: string;
}

export interface CreateTemplateSourceBody {
  url: string;
  ref?: string;
}

export const useTemplateSources = () => {
  const api = useApi();

  const base = () => '/template-sources';

  const list = () => api.get<Paginated<TemplateSource>>(base(), { query: { size: 100 } });

  const create = (body: CreateTemplateSourceBody) =>
    api.post<{ source: TemplateSource }>(base(), { body });

  const sync = (templateSourceId: string) =>
    api.post<{ source: TemplateSource }>(`${base()}/${templateSourceId}/sync`);

  const remove = (templateSourceId: string) =>
    api.del<{ message: string }>(`${base()}/${templateSourceId}`);

  return { list, create, sync, remove };
};
