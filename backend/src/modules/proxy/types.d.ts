interface EnrichedAccessLogEntry {
  at: string;
  host: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteIp: string;
  userAgent?: string;
  size: number;
  applicationId: string | null;
  applicationName: string | null;
  domainId: string | null;
  organizationId: string | null;
  unmatched: boolean;
}

interface AccessLogPageResult {
  items: EnrichedAccessLogEntry[];
  total: number;
  page: number;
  size: number;
  pages: number;
  filtered: boolean;
}

interface AccessAggregateData {
  serverId: string;
  host: string;
  minute: Date;
  applicationId?: string | null;
  domainId?: string | null;
  organizationId?: string | null;
  total: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  statusOther: number;
  durationSumMs: number;
  durationMaxMs: number;
  durationLe100: number;
  durationLe300: number;
  durationLe1000: number;
  durationLe3000: number;
  durationGt3000: number;
}

type AccessAggregate = BaseDocument<AccessAggregateData>;

interface AccessStatsPoint {
  minute: string;
  requests: number;
  errorRate: number;
  p95Ms: number;
}

interface AccessStatsHost {
  host: string;
  applicationId: string | null;
  applicationName: string | null;
  requests: number;
}

interface AccessStatsResult {
  series: AccessStatsPoint[];
  topHosts: AccessStatsHost[];
  filtered: boolean;
}
