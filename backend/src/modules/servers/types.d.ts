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
  host?: string;
  port: number;
  token?: string;
  version?: string;
  bundleHash?: string;
  installedAt?: Date;
  lastHeartbeatAt?: Date;
  tlsIssuedAt?: Date;
}

interface ServerResources {
  cpuCount?: number;
  memoryMb?: number;
  diskGb?: number;
  osRelease?: string;
  dockerVersion?: string;
  composeVersion?: string;
}

interface ServerData {
  organizationId?: string;
  name: string;
  type: import('./server.schema').ServerType;
  status: import('./server.schema').ServerStatus;
  publicIp?: string;
  ssh: ServerSshCredentials;
  agent: ServerAgent;
  resources: ServerResources;
  lastError?: string;
}

type Server = BaseDocument<ServerData>;

interface AgentCaData {
  singleton: string;
  caCertPem: string;
  caKeyPem: string;
  clientCertPem: string;
  clientKeyPem: string;
}

type AgentCa = BaseDocument<AgentCaData>;
