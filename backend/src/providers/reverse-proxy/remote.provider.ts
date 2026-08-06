import { createAgentClient, isAbortError, readAgentEvents, searchParams } from '../../utils/agent';
import type {
  AccessLogEntry,
  AccessLogPage,
  AccessQuery,
  AccessStreamQuery,
  CertificateStatus,
  ReverseProxyConnection,
  ReverseProxyProvider,
  RouteSpec,
} from './reverse-proxy.contract';

export const createRemoteReverseProxyProvider = (
  connection: ReverseProxyConnection,
): ReverseProxyProvider => {
  const { send, json, discard } = createAgentClient(connection);

  const routePath = (routeId: string) => `/proxy/routes/${encodeURIComponent(routeId)}`;
  const domainPath = (domain: string) => encodeURIComponent(domain);

  return {
    upsertRoute: ({ id, ...spec }: RouteSpec) =>
      discard(routePath(id), { method: 'PUT', body: spec }),

    removeRoute: routeId => discard(routePath(routeId), { method: 'DELETE' }),

    getRoute: async routeId => {
      const response = await send(routePath(routeId), { allowedStatuses: [404] });

      if (response.status === 404) {
        return null;
      }

      return (await response.json()) as RouteSpec;
    },

    listRoutes: () => json<RouteSpec[]>('/proxy/routes'),

    enableTls: domain => discard(`/proxy/tls/${domainPath(domain)}`, { method: 'POST' }),

    getCertificateStatus: domain =>
      json<CertificateStatus>(`/proxy/certificates/${domainPath(domain)}`),

    renewCertificate: domain =>
      discard(`/proxy/certificates/${domainPath(domain)}/renew`, { method: 'POST' }),

    reload: () => discard('/proxy/reload', { method: 'POST' }),

    listAccess: (query: AccessQuery) =>
      json<AccessLogPage>('/proxy/access', {
        query: searchParams({
          host: query.host,
          since: query.since,
          tail: query.tail,
          status: query.status,
          page: query.page,
          size: query.size,
        }),
      }),

    streamAccess: (query: AccessStreamQuery) => ({
      async *[Symbol.asyncIterator]() {
        const response = await send('/proxy/access/stream', {
          query: searchParams({
            host: query.host,
            since: query.since,
            tail: query.tail,
            status: query.status,
          }),
          streamed: true,
          signal: query.signal,
        });

        try {
          for await (const entry of readAgentEvents(response)) {
            if (entry.event === 'log') {
              yield JSON.parse(entry.data) as AccessLogEntry;
            }
          }
        } catch (error) {
          if (!isAbortError(error)) {
            throw error;
          }
        }
      },
    }),
  };
};
