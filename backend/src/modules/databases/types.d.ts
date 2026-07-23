interface DatabaseCredentialsData {
  host: string;
  port: number;
  username: string;
  database: string;
  /** Encrypted, `select: false`: the platform has to hand them back, not compare them. */
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
