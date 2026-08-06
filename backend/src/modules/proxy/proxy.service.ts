import {
  resolveReverseProxyProvider,
  type AccessLogEntry,
  type AccessQuery,
  type AccessStreamQuery,
  type ReverseProxyProvider,
} from '../../providers/reverse-proxy';
import { findApplicationNames } from '../applications/application.service';
import { findDomainsByHostnames } from '../domains/domain.service';
import { buildAgentConnection } from '../servers/server.service';
import { AccessQueryDTO, DEFAULT_PAGE_SIZE, DEFAULT_TAIL, MAX_PAGE_SIZE } from './proxy.schema';

export const resolveProxyOfServer = (server: Server): ReverseProxyProvider =>
  resolveReverseProxyProvider(buildAgentConnection(server));

const unmatchedEntry = (entry: AccessLogEntry): EnrichedAccessLogEntry => ({
  ...entry,
  applicationId: null,
  applicationName: null,
  domainId: null,
  organizationId: null,
  unmatched: true,
});

const matchedEntry = (
  entry: AccessLogEntry,
  domain: Domain,
  applicationName: string | null,
): EnrichedAccessLogEntry => ({
  ...entry,
  applicationId: String(domain.applicationId),
  applicationName,
  domainId: String(domain._id),
  organizationId: String(domain.organizationId),
  unmatched: false,
});

const enrichEntries = async (entries: AccessLogEntry[]): Promise<EnrichedAccessLogEntry[]> => {
  const hostnames = [...new Set(entries.map(entry => entry.host))];
  const domains = await findDomainsByHostnames(hostnames);
  const domainByHostname = new Map(domains.map(domain => [domain.hostname, domain]));

  const applicationIds = [...new Set(domains.map(domain => String(domain.applicationId)))];
  const applications = await findApplicationNames(applicationIds);
  const nameById = new Map(
    applications.map(application => [String(application._id), application.name]),
  );

  return entries.map(entry => {
    const domain = domainByHostname.get(entry.host);

    return domain
      ? matchedEntry(entry, domain, nameById.get(String(domain.applicationId)) ?? null)
      : unmatchedEntry(entry);
  });
};

const paginate = (entries: EnrichedAccessLogEntry[], page: number, size: number) => {
  const total = entries.length;
  const start = (page - 1) * size;

  return {
    items: entries.slice(start, start + size),
    total,
    page,
    size,
    pages: Math.ceil(total / size) || 0,
  };
};

// size is capped at the agent's own page size limit: we pull the whole allowed set once and
// re-filter/re-paginate here, instead of asking the agent to paginate before we can scope it.
const boundedAgentQuery = (query: AccessQueryDTO): AccessQuery => ({
  host: query.host,
  since: query.since,
  status: query.status,
  tail: query.tail ?? DEFAULT_TAIL,
  page: 1,
  size: MAX_PAGE_SIZE,
});

export const fetchServerAccess = async (
  proxy: ReverseProxyProvider,
  organizationId: string,
  superuser: boolean,
  query: AccessQueryDTO,
): Promise<AccessLogPageResult> => {
  const raw = await proxy.listAccess(boundedAgentQuery(query));
  const enriched = await enrichEntries(raw.items);
  const scoped = superuser
    ? enriched
    : enriched.filter(entry => entry.organizationId === organizationId);

  return {
    ...paginate(scoped, query.page ?? 1, query.size ?? DEFAULT_PAGE_SIZE),
    filtered: !superuser,
  };
};

export const fetchApplicationAccess = async (
  proxy: ReverseProxyProvider,
  hostnames: string[],
  query: AccessQueryDTO,
): Promise<AccessLogPageResult> => {
  const raw = await proxy.listAccess(boundedAgentQuery(query));
  const enriched = await enrichEntries(raw.items);
  const scoped = enriched.filter(entry => hostnames.includes(entry.host));

  return {
    ...paginate(scoped, query.page ?? 1, query.size ?? DEFAULT_PAGE_SIZE),
    filtered: false,
  };
};

const streamEnriched = (
  source: AsyncIterable<AccessLogEntry>,
  allow: (entry: EnrichedAccessLogEntry) => boolean,
): AsyncIterable<EnrichedAccessLogEntry> => ({
  async *[Symbol.asyncIterator]() {
    const domainCache = new Map<string, Domain | null>();
    const nameCache = new Map<string, string | null>();

    for await (const entry of source) {
      if (!domainCache.has(entry.host)) {
        const [domain] = await findDomainsByHostnames([entry.host]);
        domainCache.set(entry.host, domain ?? null);
      }

      const domain = domainCache.get(entry.host) ?? null;

      if (!domain) {
        const enriched = unmatchedEntry(entry);

        if (allow(enriched)) {
          yield enriched;
        }

        continue;
      }

      const applicationId = String(domain.applicationId);

      if (!nameCache.has(applicationId)) {
        const [application] = await findApplicationNames([applicationId]);
        nameCache.set(applicationId, application?.name ?? null);
      }

      const enriched = matchedEntry(entry, domain, nameCache.get(applicationId) ?? null);

      if (allow(enriched)) {
        yield enriched;
      }
    }
  },
});

export const streamServerAccess = (
  proxy: ReverseProxyProvider,
  organizationId: string,
  superuser: boolean,
  query: AccessStreamQuery,
) =>
  streamEnriched(
    proxy.streamAccess(query),
    entry => superuser || entry.organizationId === organizationId,
  );

export const streamApplicationAccess = (
  proxy: ReverseProxyProvider,
  hostnames: string[],
  query: AccessStreamQuery,
) => streamEnriched(proxy.streamAccess(query), entry => hostnames.includes(entry.host));
