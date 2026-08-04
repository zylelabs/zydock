import type { Paginated } from '../useApi';

export interface UserSession {
  id: string;
  userAgent?: string;
  ip?: string;
  current: boolean;
  expiresAt: string;
  lastUsedAt?: string;
  createdAt: string;
}

export const useSessions = () => {
  const api = useApi();

  const list = () => api.get<Paginated<UserSession>>('/auth/sessions', { query: { size: 100 } });

  const revoke = (id: string) => api.del<{ message: string }>(`/auth/sessions/${id}`);

  const revokeAll = () => api.del<{ message: string }>('/auth/sessions');

  return { list, revoke, revokeAll };
};
