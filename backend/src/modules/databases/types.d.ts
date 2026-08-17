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
}

type ManagedDatabase = BaseDocument<DatabaseData>;

interface DatabaseConsumer {
  applicationId: string;
  name: string;
  variableKey: string;
}
