interface DomainData {
  organizationId: string;
  applicationId: string;
  serverId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
  auto: boolean;
  status: DomainStatus;
  lastError?: string;
}

type Domain = BaseDocument<DomainData>;
