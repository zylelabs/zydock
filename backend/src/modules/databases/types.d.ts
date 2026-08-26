interface DatabaseCredentialsData {
  host: string;
  port: number;
  username: string;
  database: string;
  password: string;
  connectionUri: string;
}

interface DatabaseCredentialRef {
  key?: string;
  value?: string;
}

interface DatabaseComposeLink {
  applicationId: string;
  service: string;
  username?: DatabaseCredentialRef;
  password: DatabaseCredentialRef;
  database?: DatabaseCredentialRef;
}

interface DatabasePublicAccess {
  enabled: boolean;
  hostPort?: number;
  appliedAt?: Date;
}

interface DatabaseData {
  organizationId: string;
  serverId: string;
  name: string;
  slug: string;
  engine: DatabaseEngineName;
  version?: string;
  status: DatabaseInstanceStatus;
  source: import('./database.schema').DatabaseSource;
  containerId?: string;
  containerName?: string;
  credentials?: DatabaseCredentialsData;
  link?: DatabaseComposeLink;
  lastError?: string;
  publicAccess?: DatabasePublicAccess;
}

type ManagedDatabase = BaseDocument<DatabaseData>;

interface DatabaseConsumer {
  applicationId: string;
  name: string;
  variableKey?: string;
  connections?: number;
}

interface DatabaseSampleData {
  databaseId: string;
  capturedAt: Date;
  connections?: number;
  maxConnections?: number;
  sizeBytes?: number;
}

type DatabaseSample = BaseDocument<DatabaseSampleData>;
