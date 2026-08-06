import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { caddyAccessLogSchema } from './proxy.schema';
import {
  AccessQueryDTO,
  AccessStreamQueryDTO,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TAIL,
} from './proxy.access.schema';

const containers = resolveContainerProvider();

export type AccessLogEntry = {
  at: string;
  host: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteIp: string;
  userAgent?: string;
  size: number;
};

type AccessFilter = { host?: string; status?: number };

const normalize = (entry: ReturnType<typeof caddyAccessLogSchema.parse>): AccessLogEntry => ({
  at: new Date(entry.ts * 1000).toISOString(),
  host: entry.request.host,
  method: entry.request.method,
  path: entry.request.uri,
  status: entry.status,
  durationMs: Math.round(entry.duration * 1000),
  remoteIp: entry.request.remote_ip,
  userAgent: entry.request.headers?.['User-Agent']?.[0],
  size: entry.size,
});

export const parseLine = (message: string): AccessLogEntry | null => {
  let raw: unknown;

  try {
    raw = JSON.parse(message);
  } catch {
    return null;
  }

  const result = caddyAccessLogSchema.safeParse(raw);

  return result.success ? normalize(result.data) : null;
};

const matches = (entry: AccessLogEntry, filter: AccessFilter) =>
  (!filter.host || entry.host === filter.host) &&
  (filter.status === undefined || entry.status === filter.status);

export const resolveContainerId = async () => {
  const [container] = await containers.listContainers({
    labels: { 'com.docker.compose.service': config.proxy.containerService },
  });

  if (!container) {
    throw new Error(
      `Proxy container not found (label com.docker.compose.service=${config.proxy.containerService})`,
    );
  }

  return container.id;
};

export const listAccess = async (query: AccessQueryDTO) => {
  const id = await resolveContainerId();
  const page = query.page ?? 1;
  const size = query.size ?? DEFAULT_PAGE_SIZE;

  const logs = await containers.getLogs(id, {
    tail: query.tail ?? DEFAULT_TAIL,
    since: query.since,
  });

  const entries = logs
    .flatMap(log => {
      const entry = parseLine(log.message);

      return entry ? [entry] : [];
    })
    .filter(entry => matches(entry, query))
    .sort((a, b) => b.at.localeCompare(a.at));

  const total = entries.length;
  const start = (page - 1) * size;

  return {
    items: entries.slice(start, start + size),
    total,
    page,
    size,
    pages: Math.ceil(total / size) || 0,
  };
};

export const streamAccess = (
  query: AccessStreamQueryDTO & { signal?: AbortSignal },
): AsyncIterable<AccessLogEntry> => ({
  async *[Symbol.asyncIterator]() {
    const id = await resolveContainerId();

    for await (const log of containers.streamLogs(id, {
      tail: query.tail,
      since: query.since,
      signal: query.signal,
    })) {
      const entry = parseLine(log.message);

      if (entry && matches(entry, query)) {
        yield entry;
      }
    }
  },
});
