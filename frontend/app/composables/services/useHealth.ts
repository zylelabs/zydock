export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  commit: string;
  uptime: number;
  timestamp: string;
}

export const installedVersionLabel = (installed?: { version?: string; commit?: string } | null) => {
  if (installed?.version) {
    return `v${installed.version}`;
  }

  if (installed?.commit) {
    return installed.commit.slice(0, 7);
  }

  return '';
};

export const useHealth = () => {
  const api = useApi();

  const get = () => api.get<HealthReport>('/health', { anonymous: true });

  return { get };
};
