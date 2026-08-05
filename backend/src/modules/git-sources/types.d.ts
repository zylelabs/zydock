interface GitSourceData {
  organizationId: string;
  name: string;
  status: import('./git-source.schema').GitSourceStatus;
  state?: string;
  stateExpiresAt?: Date;
  appId?: string;
  slug?: string;
  htmlUrl?: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
  privateKey?: string;
  createdBy: string;
}

type GitSource = BaseDocument<GitSourceData>;
