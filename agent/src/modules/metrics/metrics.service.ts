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

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

const systemCache = createTtlCache<SystemMetrics>(config.metricsCacheTtlSeconds);
const containerCache = createTtlCache<ContainerMetrics[]>(config.metricsCacheTtlSeconds);

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

const parseSize = (value: string) => {
  const match = value.trim().match(/^([\d.]+)\s*([A-Za-z]*)$/);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();

  const factors: Record<string, number> = {
    b: 1 / MB,
    kb: 1 / 1024,
    kib: 1 / 1024,
    mb: 1,
    mib: 1,
    gb: 1024,
    gib: 1024,
  };

  return Math.round(amount * (factors[unit] ?? 1) * 10) / 10;
};

export const collectContainerMetrics = () =>
  containerCache.resolve(async () => {
    const process = Bun.spawn(
      [
        'docker',
        'stats',
        '--no-stream',
        '--format',
        '{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
      ],
      { stdout: 'pipe', stderr: 'ignore' },
    );

    const output = await new Response(process.stdout).text();

    await process.exited;

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, name, cpu, memory] = line.split('|');
        const [used, limit] = (memory ?? '').split('/');

        return {
          id: id ?? '',
          name: name ?? '',
          cpuPercent: Number((cpu ?? '0').replace('%', '')) || 0,
          memoryUsedMb: parseSize(used ?? '0'),
          memoryLimitMb: parseSize(limit ?? '0'),
        };
      });
  });

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
