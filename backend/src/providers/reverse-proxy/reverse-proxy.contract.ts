export const REVERSE_PROXY_IMPLEMENTATIONS = ['caddy', 'traefik', 'nginx'] as const;

export type ReverseProxyImplementation = (typeof REVERSE_PROXY_IMPLEMENTATIONS)[number];

export type ReverseProxyConnection = {
  serverId: string;
  endpoint: string;
  token: string;
  implementation?: ReverseProxyImplementation;
};

export type RouteUpstream = {
  host: string;
  port: number;
};

export type RouteSpec = {
  id: string;
  domain?: string;
  isDefault?: boolean;
  upstreams: RouteUpstream[];
  pathPrefix?: string;
  tls?: boolean;
  headers?: Record<string, string>;
};

export type CertificateStatus = {
  domain: string;
  valid: boolean;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
};

export type AccessLogEntry = {
  at: string;
  host: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteIp: string;
  userAgent?: string;
  size: number;
};

export type AccessLogPage = {
  items: AccessLogEntry[];
  total: number;
  page: number;
  size: number;
  pages: number;
};

export type AccessQuery = {
  host?: string;
  since?: string;
  tail?: number;
  status?: number;
  page?: number;
  size?: number;
};

export type AccessStreamQuery = Omit<AccessQuery, 'page' | 'size'> & { signal?: AbortSignal };

export type ReverseProxyProvider = {
  upsertRoute: (spec: RouteSpec) => Promise<void>;
  removeRoute: (routeId: string) => Promise<void>;
  getRoute: (routeId: string) => Promise<RouteSpec | null>;
  listRoutes: () => Promise<RouteSpec[]>;
  enableTls: (domain: string) => Promise<void>;
  getCertificateStatus: (domain: string) => Promise<CertificateStatus>;
  renewCertificate: (domain: string) => Promise<void>;
  reload: () => Promise<void>;
  listAccess: (query: AccessQuery) => Promise<AccessLogPage>;
  streamAccess: (query: AccessStreamQuery) => AsyncIterable<AccessLogEntry>;
};

export type ReverseProxyProviderFactory = (
  connection: ReverseProxyConnection,
) => ReverseProxyProvider;
