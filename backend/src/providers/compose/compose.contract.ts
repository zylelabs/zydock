export type ComposeConnection = {
  serverId: string;
  endpoint: string;
  token: string;
  runtime?: string;
};

export type ComposeFileName = 'docker-compose.yml' | 'zydock.override.yml' | '.env';

export type ComposeFile = {
  name: ComposeFileName;
  content: string;
};

export type ComposeConfigResult = {
  valid: boolean;
  output: string;
  error?: string;
};

export type ComposeServicePublisher = {
  url: string;
  targetPort: number;
  publishedPort?: number;
  protocol: string;
};

export type ComposeServiceStatus = {
  name: string;
  service: string;
  state: string;
  health: string;
  publishers: ComposeServicePublisher[];
};

export type ComposeLogEntry = {
  stream: 'stdout' | 'stderr';
  message: string;
};

export type ComposeProvider = {
  writeFiles: (project: string, files: ComposeFile[]) => Promise<void>;
  config: (project: string) => Promise<ComposeConfigResult>;
  pull: (project: string, onLog?: (entry: ComposeLogEntry) => void) => Promise<void>;
  up: (project: string, onLog?: (entry: ComposeLogEntry) => void) => Promise<void>;
  down: (project: string, removeVolumes: boolean) => Promise<void>;
  ps: (project: string) => Promise<ComposeServiceStatus[]>;
  restart: (project: string, service?: string) => Promise<void>;
};

export type ComposeProviderFactory = (connection: ComposeConnection) => ComposeProvider;
