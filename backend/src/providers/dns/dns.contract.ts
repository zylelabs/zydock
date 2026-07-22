export const DNS_IMPLEMENTATIONS = ['cloudflare', 'route53'] as const;

export type DnsImplementation = (typeof DNS_IMPLEMENTATIONS)[number];

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT';

export type DnsCredentials = {
  token: string;
  implementation?: DnsImplementation;
  accountId?: string;
};

export type DnsRecord = {
  zone: string;
  name: string;
  type: DnsRecordType;
  value: string;
  id?: string;
  ttlSeconds?: number;
  proxied?: boolean;
};

export type DnsProvider = {
  listRecords: (zone: string) => Promise<DnsRecord[]>;
  upsertRecord: (record: DnsRecord) => Promise<DnsRecord>;
  removeRecord: (zone: string, recordId: string) => Promise<void>;
  verifyRecord: (record: DnsRecord) => Promise<boolean>;
};

export type DnsProviderFactory = (credentials: DnsCredentials) => DnsProvider;
