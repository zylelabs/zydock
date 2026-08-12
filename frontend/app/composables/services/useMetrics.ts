export interface SystemMetrics {
  cpuPercent?: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  uptimeSeconds: number;
  containersRunning: number;
  containersTotal: number;
}

export interface ContainerMetric {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
}

export interface MetricSample {
  capturedAt: string;
  cpuPercent?: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  containersRunning: number;
  containersTotal: number;
}

export interface MetricHistoryFilter {
  since?: string;
  limit?: number;
}

export type ApplicationMetrics = {
  containerId: string;
  name: string;
  state: string;
  health: string;
  restartCount: number;
  uptimeSeconds?: number;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
} | null;

export interface DeploymentMetrics {
  window: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  averageDurationMs: number | null;
  averageBuildMs: number | null;
  last: {
    id: string;
    status: string;
    durationMs?: number;
    createdAt: string;
    finishedAt?: string;
  } | null;
}

export const useMetrics = () => {
  const api = useApi();
  const session = useSessionStore();

  const serverBase = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/metrics`;
  const applicationBase = (applicationId: string) =>
    `/organizations/${session.organizationId}/applications/${applicationId}/metrics`;

  const serverMetrics = (serverId: string) => api.get<SystemMetrics>(serverBase(serverId));
  const serverContainerMetrics = (serverId: string) =>
    api.get<ContainerMetric[]>(`${serverBase(serverId)}/containers`);
  const serverMetricsHistory = (serverId: string, filter: MetricHistoryFilter = {}) =>
    api.get<{ items: MetricSample[] }>(`${serverBase(serverId)}/history`, { query: { ...filter } });

  const applicationMetrics = (applicationId: string, service?: string) =>
    api.get<ApplicationMetrics>(applicationBase(applicationId), { query: { service } });
  const applicationDeploymentMetrics = (applicationId: string) =>
    api.get<DeploymentMetrics>(`${applicationBase(applicationId)}/deployments`);

  return {
    serverMetrics,
    serverContainerMetrics,
    serverMetricsHistory,
    applicationMetrics,
    applicationDeploymentMetrics,
  };
};
