interface DomainData {
  organizationId: string;
  applicationId: string;
  serverId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
  status: DomainStatus;
  lastError?: string;
}

type Domain = BaseDocument<DomainData>;
