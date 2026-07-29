export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntry {
  timestamp?: string;
  stream?: 'stdout' | 'stderr';
  message: string;
  level: LogLevel;
}

export interface LogFilters {
  search?: string;
  stream?: 'stdout' | 'stderr';
  level?: LogLevel;
  tail?: number;
}

export const useLogs = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (applicationId: string) =>
    `/organizations/${session.organizationId}/applications/${applicationId}/logs`;

  const history = (applicationId: string, filters: LogFilters = {}) =>
    api.get<{ entries: LogEntry[] }>(base(applicationId), { query: { ...filters } });

  const download = (applicationId: string, filters: LogFilters = {}) =>
    api.get<string>(`${base(applicationId)}/download`, { query: { ...filters } });

  const topic = (applicationId: string) => `application:${applicationId}:logs`;

  return { history, download, topic };
};
