import config from '../../config';
import type {
  BuildImageSpec,
  ContainerConnection,
  ContainerFilter,
  ContainerInfo,
  ContainerProvider,
  ContainerSpec,
  ExecRequest,
  ExecResult,
  ImageInfo,
  LogEntry,
  LogQuery,
  LogStreamQuery,
  NetworkInfo,
  VolumeInfo,
} from './container.contract';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: URLSearchParams;
  body?: unknown;
  /** Streamed calls answer with an event stream, so they use the caller's signal instead of a timeout. */
  signal?: AbortSignal;
  streamed?: boolean;
  allowedStatuses?: number[];
};

type ServerEvent = {
  event: string;
  data: string;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const searchParams = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  return params;
};

const describeFailure = async (response: Response) => {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as { error?: unknown };

    return typeof parsed.error === 'string' ? parsed.error : body;
  } catch {
    return body.trim() || `HTTP ${response.status}`;
  }
};

const parseEvent = (raw: string): ServerEvent | null => {
  const data: string[] = [];

  let event = 'message';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart());
    }
  }

  return data.length ? { event, data: data.join('\n') } : null;
};

const readEvents = async function* (response: Response): AsyncGenerator<ServerEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const parsed = parseEvent(buffer.slice(0, boundary));

        buffer = buffer.slice(boundary + 2);

        if (parsed) {
          yield parsed;
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

/**
 * Talks to the agent installed on the server. Every Docker operation runs there — the backend never
 * reaches a container runtime directly.
 */
export const createRemoteContainerProvider = (
  connection: ContainerConnection,
): ContainerProvider => {
  const send = async (path: string, options: RequestOptions = {}) => {
    const { method = 'GET', query, body, signal, streamed = false, allowedStatuses = [] } = options;

    const url = new URL(`/api${path}`, connection.endpoint);

    if (query) {
      url.search = query.toString();
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          'X-Agent-Token': connection.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: streamed ? signal : AbortSignal.timeout(config.node.requestTimeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Agent of server ${connection.serverId} did not answer ${method} ${path}: ${messageOf(error)}`,
      );
    }

    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new Error(
        `Agent of server ${connection.serverId} refused ${method} ${path}: ${await describeFailure(response)}`,
      );
    }

    return response;
  };

  const json = async <T>(path: string, options: RequestOptions = {}) =>
    (await send(path, options)).json() as Promise<T>;

  const discard = async (path: string, options: RequestOptions = {}) => {
    await send(path, options);
  };

  const containerPath = (id: string) => `/containers/${encodeURIComponent(id)}`;

  return {
    createContainer: (spec: ContainerSpec) =>
      json<ContainerInfo>('/containers', { method: 'POST', body: spec }),

    startContainer: id => discard(`${containerPath(id)}/start`, { method: 'POST' }),

    stopContainer: (id, timeoutSeconds) =>
      discard(`${containerPath(id)}/stop`, {
        method: 'POST',
        query: searchParams({ timeout: timeoutSeconds }),
      }),

    restartContainer: id => discard(`${containerPath(id)}/restart`, { method: 'POST' }),

    removeContainer: (id, removeVolumes) =>
      discard(containerPath(id), {
        method: 'DELETE',
        query: searchParams({ volumes: removeVolumes ? 'true' : undefined }),
      }),

    inspectContainer: async id => {
      const response = await send(containerPath(id), { allowedStatuses: [404] });

      if (response.status === 404) {
        return null;
      }

      return (await response.json()) as ContainerInfo;
    },

    listContainers: (filter: ContainerFilter = {}) => {
      const query = searchParams({ state: filter.state, namePrefix: filter.namePrefix });

      for (const [key, value] of Object.entries(filter.labels ?? {})) {
        query.append('label', `${key}=${value}`);
      }

      return json<ContainerInfo[]>('/containers', { query });
    },

    getLogs: (id, query: LogQuery = {}) =>
      json<LogEntry[]>(`${containerPath(id)}/logs`, {
        query: searchParams({ tail: query.tail, since: query.since, until: query.until }),
      }),

    streamLogs: (id, query: LogStreamQuery = {}) => ({
      async *[Symbol.asyncIterator]() {
        const response = await send(`${containerPath(id)}/logs`, {
          query: searchParams({
            tail: query.tail,
            since: query.since,
            until: query.until,
            follow: 'true',
          }),
          streamed: true,
          signal: query.signal,
        });

        try {
          for await (const entry of readEvents(response)) {
            if (entry.event === 'log') {
              yield JSON.parse(entry.data) as LogEntry;
            }
          }
        } catch (error) {
          // Aborting is how a caller closes the stream — the local provider ends quietly too.
          if (!isAbort(error)) {
            throw error;
          }
        }
      },
    }),

    // `timeoutSeconds` is not enforced yet: the agent runs `docker exec` to completion.
    execCommand: (id, request: ExecRequest) =>
      json<ExecResult>(`${containerPath(id)}/exec`, { method: 'POST', body: request }),

    buildImage: async (spec: BuildImageSpec) => {
      const { onLog, ...payload } = spec;

      const response = await send('/images/build', {
        method: 'POST',
        body: payload,
        streamed: true,
      });

      let image: ImageInfo | null = null;
      let failure: string | null = null;

      for await (const entry of readEvents(response)) {
        if (entry.event === 'log') {
          onLog?.(JSON.parse(entry.data) as LogEntry);
        } else if (entry.event === 'result') {
          image = JSON.parse(entry.data) as ImageInfo;
        } else if (entry.event === 'error') {
          failure = (JSON.parse(entry.data) as { error: string }).error;
        }
      }

      if (failure) {
        throw new Error(`Failed to build image ${spec.tag}: ${failure}`);
      }

      if (!image) {
        throw new Error(
          `Failed to build image ${spec.tag}: the agent closed the stream without a result`,
        );
      }

      return image;
    },

    pullImage: reference =>
      json<ImageInfo>('/images/pull', { method: 'POST', body: { reference } }),

    removeImage: reference =>
      discard('/images', { method: 'DELETE', query: searchParams({ reference }) }),

    createNetwork: name => json<NetworkInfo>('/networks', { method: 'POST', body: { name } }),

    removeNetwork: name => discard(`/networks/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    listNetworks: () => json<NetworkInfo[]>('/networks'),

    createVolume: name => json<VolumeInfo>('/volumes', { method: 'POST', body: { name } }),

    removeVolume: name => discard(`/volumes/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    listVolumes: () => json<VolumeInfo[]>('/volumes'),
  };
};
