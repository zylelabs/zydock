import { createAgentClient } from '../../utils/agent';
import type {
  CertificateStatus,
  ReverseProxyConnection,
  ReverseProxyProvider,
  RouteSpec,
} from './reverse-proxy.contract';

/**
 * Talks to the agent installed on the server, which owns the proxy configuration. The proxy admin
 * API stays bound to the server's loopback interface — the backend never reaches it directly.
 */
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
  };
};
