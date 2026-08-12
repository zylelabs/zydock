export type ComposeFileName = 'docker-compose.yml' | 'zydock.override.yml' | '.env';

export type ComposeLogEntry = { stream: 'stdout' | 'stderr'; message: string };

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

export type ComposeProjectFiles = {
  composeFiles: string[];
  envFile?: string;
};

export type ComposeProvider = {
  config: (
    project: string,
    cwd: string,
    files: ComposeProjectFiles,
  ) => Promise<ComposeConfigResult>;
  pull: (
    project: string,
    cwd: string,
    files: ComposeProjectFiles,
    onLog?: (entry: ComposeLogEntry) => void,
  ) => Promise<void>;
  up: (
    project: string,
    cwd: string,
    files: ComposeProjectFiles,
    onLog?: (entry: ComposeLogEntry) => void,
  ) => Promise<void>;
  down: (
    project: string,
    cwd: string,
    files: ComposeProjectFiles,
    removeVolumes: boolean,
  ) => Promise<void>;
  ps: (project: string, cwd: string, files: ComposeProjectFiles) => Promise<ComposeServiceStatus[]>;
  restart: (
    project: string,
    cwd: string,
    files: ComposeProjectFiles,
    service?: string,
  ) => Promise<void>;
  version: () => Promise<string>;
};
