export const CONTAINER_RUNTIMES = ['docker', 'podman', 'kubernetes', 'nomad'] as const;

export type ContainerRuntime = (typeof CONTAINER_RUNTIMES)[number];

export type ContainerState =
  'created' | 'running' | 'paused' | 'restarting' | 'exited' | 'dead' | 'unknown';

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting' | 'none';

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export type PortBinding = {
  containerPort: number;
  hostPort?: number;
  protocol: 'tcp' | 'udp';
};

export type VolumeBinding = {
  source: string;
  target: string;
  readOnly?: boolean;
};

export type HealthcheckSpec = {
  command: string[];
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds?: number;
};

export type ResourceLimits = {
  cpus?: number;
  memoryMb?: number;
};

export type ContainerSpec = {
  name: string;
  image: string;
  command?: string[];
  environment?: Record<string, string>;
  ports?: PortBinding[];
  volumes?: VolumeBinding[];
  networks?: string[];
  labels?: Record<string, string>;
  restartPolicy?: RestartPolicy;
  healthcheck?: HealthcheckSpec;
  resources?: ResourceLimits;
};

export type ContainerInfo = {
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
};

export type ContainerFilter = {
  labels?: Record<string, string>;
  state?: ContainerState;
  namePrefix?: string;
};

export type LogEntry = {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  message: string;
};

export type LogQuery = {
  since?: string;
  until?: string;
  tail?: number;
};

export type LogStreamQuery = LogQuery & {
  signal?: AbortSignal;
};

export type ExecRequest = {
  command: string[];
  workingDir?: string;
  environment?: Record<string, string>;
  user?: string;
  timeoutSeconds?: number;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BuildImageSpec = {
  contextPath: string;
  dockerfilePath?: string;
  tag: string;
  buildArgs?: Record<string, string>;
  target?: string;
  onLog?: (entry: LogEntry) => void;
};

export type ImageInfo = {
  id: string;
  tag: string;
  sizeBytes: number;
  createdAt: string;
};

export type NetworkInfo = {
  id: string;
  name: string;
  driver: string;
  labels: Record<string, string>;
};

export type VolumeInfo = {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
};

export type ConsoleRequest = {
  shell: string;
  columns?: number;
  rows?: number;
  onData: (chunk: string) => void;
  onClose: () => void;
};

export type ConsoleSession = {
  write: (data: string | Uint8Array) => void;
  resize: (columns: number, rows: number) => Promise<void>;
  close: () => void;
};

export type ArchiveStream = ReadableStream<Uint8Array>;

export type ContainerProvider = {
  createContainer: (spec: ContainerSpec) => Promise<ContainerInfo>;
  startContainer: (id: string) => Promise<void>;
  stopContainer: (id: string, timeoutSeconds?: number) => Promise<void>;
  restartContainer: (id: string) => Promise<void>;
  removeContainer: (id: string, removeVolumes?: boolean) => Promise<void>;
  inspectContainer: (id: string) => Promise<ContainerInfo | null>;
  listContainers: (filter?: ContainerFilter) => Promise<ContainerInfo[]>;
  getLogs: (id: string, query?: LogQuery) => Promise<LogEntry[]>;
  streamLogs: (id: string, query?: LogStreamQuery) => AsyncIterable<LogEntry>;
  execCommand: (id: string, request: ExecRequest) => Promise<ExecResult>;
  openConsole: (id: string, request: ConsoleRequest) => Promise<ConsoleSession>;
  buildImage: (spec: BuildImageSpec) => Promise<ImageInfo>;
  pullImage: (reference: string) => Promise<ImageInfo>;
  removeImage: (reference: string) => Promise<void>;
  listImages: () => Promise<ImageInfo[]>;
  createNetwork: (name: string) => Promise<NetworkInfo>;
  removeNetwork: (name: string) => Promise<void>;
  listNetworks: () => Promise<NetworkInfo[]>;
  createVolume: (name: string) => Promise<VolumeInfo>;
  removeVolume: (name: string) => Promise<void>;
  listVolumes: () => Promise<VolumeInfo[]>;
  archiveVolume: (name: string) => Promise<ArchiveStream>;
  restoreVolume: (name: string, archivePath: string) => Promise<void>;
  archiveFromContainer: (id: string, command: string[]) => Promise<ArchiveStream>;
  restoreIntoContainer: (id: string, command: string[], archivePath: string) => Promise<void>;
};

export type ContainerProviderFactory = () => ContainerProvider;
