export const CONTAINER_STATES = [
  'created',
  'running',
  'paused',
  'restarting',
  'exited',
  'dead',
  'unknown',
] as const;

export type ContainerState = (typeof CONTAINER_STATES)[number];

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting' | 'none';

export interface PortBinding {
  containerPort: number;
  hostPort?: number;
  protocol: 'tcp' | 'udp';
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  health: ContainerHealth;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  restartCount: number;
  ports: PortBinding[];
  labels: Record<string, string>;
}

export interface ContainerFilter {
  state?: ContainerState;
  namePrefix?: string;
  applicationId?: string;
}

export interface ContainerLogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  message: string;
}

export const APPLICATION_LABEL = 'zydock.application';

export const useContainers = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/containers`;

  const list = (serverId: string, filter: ContainerFilter = {}) =>
    api.get<ContainerInfo[]>(base(serverId), { query: { ...filter } });

  const start = (serverId: string, containerId: string) =>
    api.post<{ message: string }>(`${base(serverId)}/${containerId}/start`);

  const stop = (serverId: string, containerId: string) =>
    api.post<{ message: string }>(`${base(serverId)}/${containerId}/stop`);

  const restart = (serverId: string, containerId: string) =>
    api.post<{ message: string }>(`${base(serverId)}/${containerId}/restart`);

  const logs = (serverId: string, containerId: string, tail = 200) =>
    api.get<ContainerLogEntry[]>(`${base(serverId)}/${containerId}/logs`, { query: { tail } });

  const remove = (serverId: string, containerId: string, removeVolumes = false) =>
    api.del<{ message: string }>(`${base(serverId)}/${containerId}`, {
      query: { volumes: removeVolumes },
    });

  return { list, start, stop, restart, logs, remove };
};
