import { readFile } from 'node:fs/promises';
import { cpus, freemem, totalmem, uptime } from 'node:os';
import config from '../../config';
import { createTtlCache } from '../../utils/cache';
import { logDebug } from '../../utils/logger';
import { resolveContainerProvider } from '../../providers/container';

export type SystemMetrics = {
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
};

export type ContainerMetrics = {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
};

export type ContainerMetricsFilter = {
  ids?: string[];
  labels?: Record<string, string>;
};

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

const systemCache = createTtlCache<SystemMetrics>(config.metricsCacheTtlSeconds);
const containerCache = createTtlCache<ContainerMetrics[]>(config.metricsCacheTtlSeconds);

const DOCKER_API_ORIGIN = 'http://docker';

type DockerStats = {
  name?: string;
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number; inactive_file?: number };
  };
};

const cpuPercentOf = (stats: DockerStats) => {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus =
    stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

  if (cpuDelta <= 0 || systemDelta <= 0) {
    return 0;
  }

  return Math.round((cpuDelta / systemDelta) * onlineCpus * 100 * 10) / 10;
};

const memoryOf = (stats: DockerStats) => {
  const cache = stats.memory_stats.stats?.cache ?? stats.memory_stats.stats?.inactive_file ?? 0;
  const used = (stats.memory_stats.usage ?? 0) - cache;

  return {
    memoryUsedMb: Math.round((used / MB) * 10) / 10,
    memoryLimitMb: Math.round(((stats.memory_stats.limit ?? 0) / MB) * 10) / 10,
  };
};

const readContainerStats = async (id: string): Promise<ContainerMetrics | null> => {
  const response = await fetch(`${DOCKER_API_ORIGIN}/containers/${id}/stats?stream=false`, {
    unix: config.dockerSocketPath,
  });

  if (!response.ok) {
    return null;
  }

  const stats = (await response.json()) as DockerStats;

  return {
    id,
    name: stats.name?.replace(/^\//, '') ?? '',
    cpuPercent: cpuPercentOf(stats),
    ...memoryOf(stats),
  };
};

const resolveTargetIds = async (filter: ContainerMetricsFilter) => {
  if (filter.ids?.length) {
    return filter.ids;
  }

  const running = await resolveContainerProvider().listContainers({
    state: 'running',
    labels: filter.labels,
  });

  return running.map(container => container.id);
};

const readManyContainerStats = async (filter: ContainerMetricsFilter) => {
  const ids = await resolveTargetIds(filter);
  const results = await Promise.all(ids.map(readContainerStats));

  return results.filter((entry): entry is ContainerMetrics => entry !== null);
};

const readLoadPercent = async () => {
  try {
    const raw = await readFile('/proc/loadavg', 'utf8');
    const load = Number(raw.split(' ')[0]);
    const cores = cpus().length || 1;

    if (!Number.isFinite(load)) {
      return undefined;
    }

    return Math.min(100, Math.round((load / cores) * 100));
  } catch {
    return undefined;
  }
};

const readNetwork = async () => {
  try {
    const raw = await readFile('/proc/net/dev', 'utf8');

    let rx = 0;
    let tx = 0;

    for (const line of raw.split('\n')) {
      const [name, rest] = line.split(':');

      if (!rest || name.trim() === 'lo') {
        continue;
      }

      const columns = rest.trim().split(/\s+/);

      rx += Number(columns[0]) || 0;
      tx += Number(columns[8]) || 0;
    }

    return { networkRxBytes: rx, networkTxBytes: tx };
  } catch {
    return {};
  }
};

const readDisk = async () => {
  const process = Bun.spawn(['df', '-B1', '--output=size,used', '/'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const output = await new Response(process.stdout).text();

  await process.exited;

  const line = output.trim().split('\n').at(-1)?.trim().split(/\s+/) ?? [];

  const total = Number(line[0]);
  const used = Number(line[1]);

  if (!Number.isFinite(total) || !Number.isFinite(used)) {
    return {};
  }

  return {
    diskTotalGb: Math.round((total / GB) * 10) / 10,
    diskUsedGb: Math.round((used / GB) * 10) / 10,
  };
};

export const collectContainerMetrics = (filter: ContainerMetricsFilter = {}) => {
  if (filter.ids?.length || filter.labels) {
    return readManyContainerStats(filter);
  }

  return containerCache.resolve(() => readManyContainerStats({}));
};

export const collectSystemMetrics = () =>
  systemCache.resolve(async () => {
    const containers = await resolveContainerProvider().listContainers();

    const [cpuPercent, disk, network] = await Promise.all([
      readLoadPercent(),
      readDisk(),
      readNetwork(),
    ]);

    logDebug('metrics collected', { containers: containers.length });

    return {
      cpuPercent,
      memoryUsedMb: Math.round((totalmem() - freemem()) / MB),
      memoryTotalMb: Math.round(totalmem() / MB),
      ...disk,
      ...network,
      uptimeSeconds: Math.round(uptime()),
      containersRunning: containers.filter(container => container.state === 'running').length,
      containersTotal: containers.length,
    };
  });
