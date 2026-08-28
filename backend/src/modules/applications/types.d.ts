interface ApplicationGit {
  host: import('../../providers/git').GitHost;
  repository?: string;
  branch: string;
  dockerfilePath: string;
  buildContext: string;
  autoDeploy: boolean;
  injectBuildArgs: boolean;
  token?: string;
  hasToken: boolean;
  webhookId?: string;
  webhookSecret?: string;
  source: import('./application.schema').ApplicationGitSource;
  gitSourceId?: string;
  installationId?: string;
}

interface ApplicationComposeExpose {
  service: string;
  port: number;
  kind: 'http' | 'tcp' | 'udp';
  startupTimeoutSeconds?: number;
}

interface ApplicationConsole {
  logFile: string;
  tailLines: number;
}

interface ApplicationCompose {
  content: string;
  expose: ApplicationComposeExpose;
  console?: ApplicationConsole;
}

interface ApplicationOrigin {
  templateId: string;
  templateVersion: number;
  inputs: Record<string, string>;
  composeHash?: string;
}

interface ApplicationVariable {
  key: string;
  value: string;
  secret: boolean;
  build: boolean;
  buildSecret: boolean;
}

interface ApplicationVolume {
  source: string;
  target: string;
  readOnly?: boolean;
}

interface ApplicationPortMapping {
  hostPort: number;
  containerPort: number;
  protocol: 'tcp' | 'udp';
}

interface ApplicationHealthcheck {
  path: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds?: number;
}

interface ApplicationResources {
  cpus?: number;
  memoryMb?: number;
}

interface ApplicationData {
  organizationId: string;
  projectId: string;
  environmentId: string;
  serverId: string;
  name: string;
  slug: string;
  status: import('./application.schema').ApplicationStatus;
  source: import('./application.schema').ApplicationSource;
  git: ApplicationGit;
  compose?: ApplicationCompose;
  origin?: ApplicationOrigin;
  port?: number;
  portMappings: ApplicationPortMapping[];
  variables: ApplicationVariable[];
  volumes: ApplicationVolume[];
  networks: string[];
  healthcheck?: ApplicationHealthcheck;
  resources?: ApplicationResources;
  restartPolicy: import('./application.schema').ApplicationRestartPolicy;
  lastError?: string;
  autoDomainDisabled: boolean;
  unconsumedBuildArgs: string[];
  unconsumedBuildSecrets: string[];
}

type Application = BaseDocument<ApplicationData>;
