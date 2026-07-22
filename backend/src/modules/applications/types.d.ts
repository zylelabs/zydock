interface ApplicationGit {
  host: import('../../providers/git').GitHost;
  repository: string;
  branch: string;
  dockerfilePath: string;
  buildContext: string;
  autoDeploy: boolean;
  token?: string;
  hasToken: boolean;
  webhookId?: string;
  webhookSecret?: string;
}

interface ApplicationVariable {
  key: string;
  value: string;
  secret: boolean;
}

interface ApplicationVolume {
  source: string;
  target: string;
  readOnly?: boolean;
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
  git: ApplicationGit;
  port: number;
  variables: ApplicationVariable[];
  volumes: ApplicationVolume[];
  networks: string[];
  healthcheck?: ApplicationHealthcheck;
  resources?: ApplicationResources;
  restartPolicy: import('./application.schema').ApplicationRestartPolicy;
  lastError?: string;
}

type Application = BaseDocument<ApplicationData>;
