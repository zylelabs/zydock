import type { Paginated } from '~/composables/use-api';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface CreateApiKeyBody {
  name: string;
  expiresInDays?: number;
}

/** The user's own API keys — not organization-scoped, hangs off the authenticated session. */
export const useApiKeys = () => {
  const api = useApi();

  const list = () => api.get<Paginated<ApiKey>>('/auth/api-keys', { query: { size: 100 } });
  const create = (body: CreateApiKeyBody) =>
    api.post<{ apiKey: ApiKey; token: string }>('/auth/api-keys', { body });
  const revoke = (id: string) => api.del<{ message: string }>(`/auth/api-keys/${id}`);

  return { list, create, revoke };
};
