export type DashboardStatus = 'disabled' | 'pending' | 'active' | 'error';

export interface DashboardSettings {
  domain: string;
  status: DashboardStatus;
  lastError?: string;
  certificateIssuer?: string;
  certificateExpiresAt?: string;
  appliedAt?: string;
  publicIp: string;
  /** Address the panel keeps answering on regardless of the domain, e.g. `http://0.0.0.0:3000`. */
  ipUrl: string;
  requestHost: string;
  dnsMismatch: boolean;
}

export const useDashboardSettings = () => {
  const api = useApi();

  const get = () => api.get<DashboardSettings>('/dashboard/settings');

  const save = (domain: string) =>
    api.patch<DashboardSettings>('/dashboard/settings', { body: { domain } });

  const remove = () => api.del<DashboardSettings>('/dashboard/domain');

  const check = () => api.post<DashboardSettings>('/dashboard/domain/check');

  return { get, save, remove, check };
};
