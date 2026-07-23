interface MetricSampleData {
  serverId: string;
  capturedAt: Date;
  cpuPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  containersRunning?: number;
  containersTotal?: number;
}

type MetricSample = BaseDocument<MetricSampleData>;
