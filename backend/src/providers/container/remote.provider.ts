import { createAgentClient, isAbortError, readAgentEvents, searchParams } from '../../utils/agent';
import type {
  ArchiveStream,
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
  VolumeFileEntry,
  VolumeInfo,
} from './container.contract';

export const createRemoteContainerProvider = (
  connection: ContainerConnection,
): ContainerProvider => {
  const { send, json, discard } = createAgentClient(connection);

  const containerPath = (id: string) => `/containers/${encodeURIComponent(id)}`;

  const volumeFilesPath = (name: string) => `/volumes/${encodeURIComponent(name)}/files`;

  const archive = async (path: string, body?: unknown): Promise<ArchiveStream> => {
    const response = await send(path, { method: 'POST', body, streamed: true });

    if (!response.body) {
      throw new Error(`Agent of server ${connection.serverId} answered ${path} with no archive`);
    }

    return response.body;
  };

  const stage = (data: ArchiveStream) =>
    json<{ id: string; sizeBytes: number }>('/backups/uploads', {
      method: 'POST',
      raw: data,
      streamed: true,
    });

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
          for await (const entry of readAgentEvents(response)) {
            if (entry.event === 'log') {
              yield JSON.parse(entry.data) as LogEntry;
            }
          }
        } catch (error) {
          if (!isAbortError(error)) {
            throw error;
          }
        }
      },
    }),

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

      for await (const entry of readAgentEvents(response)) {
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

    listImages: () => json<ImageInfo[]>('/images'),

    createNetwork: name => json<NetworkInfo>('/networks', { method: 'POST', body: { name } }),

    removeNetwork: name => discard(`/networks/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    listNetworks: () => json<NetworkInfo[]>('/networks'),

    createVolume: name => json<VolumeInfo>('/volumes', { method: 'POST', body: { name } }),

    removeVolume: name => discard(`/volumes/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    listVolumes: () => json<VolumeInfo[]>('/volumes'),

    archiveVolume: name => archive(`/backups/volumes/${encodeURIComponent(name)}/archive`),

    restoreVolume: async (name, data) => {
      const { id } = await stage(data);

      await discard(`/backups/volumes/${encodeURIComponent(name)}/restore`, {
        method: 'POST',
        body: { upload: id },
        streamed: true,
      });
    },

    archiveFromContainer: (id, command) =>
      archive(`/backups${containerPath(id)}/archive`, { command }),

    restoreIntoContainer: async (id, command, data) => {
      const upload = await stage(data);

      await discard(`/backups${containerPath(id)}/restore`, {
        method: 'POST',
        body: { command, upload: upload.id },
        streamed: true,
      });
    },

    listVolumeFiles: (name, path) =>
      json<VolumeFileEntry[]>(volumeFilesPath(name), { query: searchParams({ path }) }),

    readVolumeFile: async (name, path) => {
      const response = await send(`${volumeFilesPath(name)}/content`, {
        query: searchParams({ path }),
        streamed: true,
      });

      if (!response.body) {
        throw new Error(`Agent of server ${connection.serverId} answered with no file content`);
      }

      return response.body;
    },

    writeVolumeFile: (name, path, stream) =>
      discard(`${volumeFilesPath(name)}/content`, {
        method: 'PUT',
        query: searchParams({ path }),
        raw: stream,
        streamed: true,
      }),

    deleteVolumePath: (name, path) =>
      discard(volumeFilesPath(name), { method: 'DELETE', query: searchParams({ path }) }),

    createVolumeDirectory: (name, path) =>
      discard(`${volumeFilesPath(name)}/directory`, { method: 'POST', body: { path } }),
  };
};
