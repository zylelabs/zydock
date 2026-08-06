import config from '../../config';
import { resolveReverseProxyProvider } from '../../providers/reverse-proxy';
import { errorMessage } from '../../utils';
import { logInfo, logWarn } from '../../utils/logger';
import { getLocalServerId } from './local-server.service';
import { buildAgentConnection, findServerById } from './server.service';

const WEBSOCKET_ROUTE_ID = 'system-dashboard-websocket';
const DASHBOARD_ROUTE_ID = 'system-dashboard';
const RETRY_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 30;

const upstreamOf = (url: string) => {
  const { hostname, port, protocol } = new URL(url);

  return { host: hostname, port: Number(port) || (protocol === 'https:' ? 443 : 80) };
};

const applyDashboardRoutes = async (domain: string) => {
  const serverId = getLocalServerId();

  if (!serverId) {
    throw new Error('The local server is not registered');
  }

  const server = await findServerById(serverId);

  if (!server) {
    throw new Error('The local server was not found');
  }

  const proxy = resolveReverseProxyProvider(buildAgentConnection(server));
  const domainSpec = domain ? { domain, tls: true } : { isDefault: true, tls: false };

  await proxy.upsertRoute({
    id: WEBSOCKET_ROUTE_ID,
    ...domainSpec,
    pathPrefix: '/api/ws',
    upstreams: [upstreamOf(config.backendUrl)],
  });

  await proxy.upsertRoute({
    id: DASHBOARD_ROUTE_ID,
    ...domainSpec,
    upstreams: [upstreamOf(config.frontendUrl)],
  });
};

export const ensureDashboardRoutes = async () => {
  const domain = config.dashboard.domain;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await applyDashboardRoutes(domain);
      logInfo('Dashboard route applied', { domain: domain || '(default)' });

      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        logWarn('Could not publish the dashboard domain on the proxy', {
          domain: domain || '(default)',
          error: errorMessage(error),
        });

        return;
      }

      await Bun.sleep(RETRY_DELAY_MS);
    }
  }
};
