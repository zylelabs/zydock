import type { Paginated } from '../useApi';

export type DomainStatus = 'pending' | 'active' | 'error';

export interface Domain {
  id: string;
  organizationId: string;
  applicationId: string;
  serverId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
  status: DomainStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainBody {
  applicationId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
}

export interface UpdateDomainBody {
  pathPrefix?: string | null;
  tls?: boolean;
}

export interface DomainCertificate {
  domain: string;
  valid: boolean;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export const useDomains = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/domains`;

  const list = (filter: { applicationId?: string } = {}) =>
    api.get<Paginated<Domain>>(base(), { query: { size: 100, ...filter } });
  const create = (body: CreateDomainBody) => api.post<{ domain: Domain }>(base(), { body });
  const update = (domainId: string, body: UpdateDomainBody) =>
    api.patch<{ domain: Domain }>(`${base()}/${domainId}`, { body });
  const apply = (domainId: string) => api.post<{ domain: Domain }>(`${base()}/${domainId}/apply`);
  const renew = (domainId: string) => api.post<{ domain: Domain }>(`${base()}/${domainId}/renew`);
  const certificate = (domainId: string) =>
    api.get<DomainCertificate>(`${base()}/${domainId}/certificate`);
  const remove = (domainId: string) => api.del<{ message: string }>(`${base()}/${domainId}`);

  return { list, create, update, apply, renew, certificate, remove };
};
