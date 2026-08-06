import type { Paginated } from '../useApi';

export interface AccessLogEntry {
  at: string;
  host: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteIp: string;
  userAgent?: string;
  size: number;
  applicationId: string | null;
  applicationName: string | null;
  domainId: string | null;
  organizationId: string | null;
  unmatched: boolean;
}

export interface AccessLogFilters {
  host?: string;
  since?: string;
  tail?: number;
  status?: number;
  page?: number;
  size?: number;
}

export type AccessLogPage = Paginated<AccessLogEntry> & { filtered: boolean };

export interface AccessStatsPoint {
  minute: string;
  requests: number;
  errorRate: number;
  p95Ms: number;
}

export interface AccessStatsHost {
  host: string;
  applicationId: string | null;
  applicationName: string | null;
  requests: number;
}

export interface AccessStatsResult {
  series: AccessStatsPoint[];
  topHosts: AccessStatsHost[];
  filtered: boolean;
}

export const useProxyAccess = () => {
  const api = useApi();
  const session = useSessionStore();

  const serverBase = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/proxy`;
  const applicationBase = (applicationId: string) =>
    `/organizations/${session.organizationId}/applications/${applicationId}/proxy`;

  const serverAccess = (serverId: string, filters: AccessLogFilters = {}) =>
    api.get<AccessLogPage>(`${serverBase(serverId)}/access`, { query: { ...filters } });

  const applicationAccess = (applicationId: string, filters: AccessLogFilters = {}) =>
    api.get<AccessLogPage>(`${applicationBase(applicationId)}/access`, { query: { ...filters } });

  const serverAccessStats = (serverId: string, minutes?: number) =>
    api.get<AccessStatsResult>(`${serverBase(serverId)}/access/stats`, { query: { minutes } });

  const applicationAccessStats = (applicationId: string, minutes?: number) =>
    api.get<AccessStatsResult>(`${applicationBase(applicationId)}/access/stats`, {
      query: { minutes },
    });

  return { serverAccess, applicationAccess, serverAccessStats, applicationAccessStats };
};
