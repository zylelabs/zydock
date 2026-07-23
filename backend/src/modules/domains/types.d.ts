interface DomainData {
  organizationId: string;
  applicationId: string;
  serverId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
  /** `pending` until a deploy (or an explicit apply) configures the route on the proxy. */
  status: DomainStatus;
  lastError?: string;
}

type Domain = BaseDocument<DomainData>;
