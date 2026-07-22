interface ServerSshCredentials {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  passphrase?: string;
  fingerprint?: string;
}

interface ServerAgent {
  port: number;
  token?: string;
  version?: string;
  installedAt?: Date;
  lastHeartbeatAt?: Date;
}

interface ServerResources {
  cpuCount?: number;
  memoryMb?: number;
  diskGb?: number;
  osRelease?: string;
  dockerVersion?: string;
}

interface ServerData {
  organizationId: string;
  name: string;
  status: import('./server.schema').ServerStatus;
  ssh: ServerSshCredentials;
  agent: ServerAgent;
  resources: ServerResources;
  lastError?: string;
}

type Server = BaseDocument<ServerData>;
