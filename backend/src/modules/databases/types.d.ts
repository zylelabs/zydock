interface DatabaseCredentialsData {
  host: string;
  port: number;
  username: string;
  database: string;
  password: string;
  connectionUri: string;
}

interface DatabaseData {
  organizationId: string;
  serverId: string;
  name: string;
  slug: string;
  engine: DatabaseEngineName;
  version: string;
  status: DatabaseInstanceStatus;
  containerId?: string;
  containerName?: string;
  credentials: DatabaseCredentialsData;
  lastError?: string;
}

type ManagedDatabase = BaseDocument<DatabaseData>;
