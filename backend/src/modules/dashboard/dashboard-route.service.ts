import config from '../../config';
import { resolveReverseProxyProvider } from '../../providers/reverse-proxy';
import { errorMessage } from '../../utils';
import { logInfo, logWarn } from '../../utils/logger';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { getLocalServerId } from '../servers/local-server.service';
import dashboardModel from './dashboard.model';
import { getDashboardDocument, invalidatePublicUrlCache } from './dashboard.service';

const WEBSOCKET_ROUTE_ID = 'system-dashboard-websocket';
const CONSOLE_ROUTE_ID = 'system-dashboard-console';
const DASHBOARD_ROUTE_ID = 'system-dashboard';
const DOMAIN_WEBSOCKET_ROUTE_ID = 'system-dashboard-domain-websocket';
const DOMAIN_CONSOLE_ROUTE_ID = 'system-dashboard-domain-console';
const DOMAIN_ROUTE_ID = 'system-dashboard-domain';
const RETRY_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 30;

const PANEL_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const panelHeadersFor = (tls: boolean) => ({
  ...PANEL_SECURITY_HEADERS,
  ...(tls ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
});

const upstreamOf = (url: string) => {
  const { hostname, port, protocol } = new URL(url);

  return { host: hostname, port: Number(port) || (protocol === 'https:' ? 443 : 80) };
};

const resolveProxy = async () => {
  const serverId = getLocalServerId();

  if (!serverId) {
    throw new Error('The local server is not registered');
  }

  const server = await findServerById(serverId);

  if (!server) {
    throw new Error('The local server was not found');
  }

  return resolveReverseProxyProvider(buildAgentConnection(server));
};

export const applyDashboardRoutes = async (domain: string) => {
  const proxy = await resolveProxy();

  await proxy.upsertRoute({
    id: WEBSOCKET_ROUTE_ID,
    isDefault: true,
    tls: false,
    pathPrefix: '/api/ws',
    upstreams: [upstreamOf(config.backendUrl)],
  });

  await proxy.upsertRoute({
    id: CONSOLE_ROUTE_ID,
    isDefault: true,
    tls: false,
    pathPrefix: '/api/organizations',
    upstreams: [upstreamOf(config.backendUrl)],
  });

  await proxy.removeRoute(DASHBOARD_ROUTE_ID);
  await proxy.upsertRoute({
    id: DASHBOARD_ROUTE_ID,
    isDefault: true,
    tls: false,
    upstreams: [upstreamOf(config.frontendUrl)],
    responseHeaders: panelHeadersFor(false),
  });

  if (!domain) {
    await proxy.removeRoute(DOMAIN_WEBSOCKET_ROUTE_ID);
    await proxy.removeRoute(DOMAIN_CONSOLE_ROUTE_ID);
    await proxy.removeRoute(DOMAIN_ROUTE_ID);

    return;
  }

  await proxy.upsertRoute({
    id: DOMAIN_WEBSOCKET_ROUTE_ID,
    domain,
    tls: true,
    pathPrefix: '/api/ws',
    upstreams: [upstreamOf(config.backendUrl)],
  });

  await proxy.upsertRoute({
    id: DOMAIN_CONSOLE_ROUTE_ID,
    domain,
    tls: true,
    pathPrefix: '/api/organizations',
    upstreams: [upstreamOf(config.backendUrl)],
  });

  await proxy.upsertRoute({
    id: DOMAIN_ROUTE_ID,
    domain,
    tls: true,
    upstreams: [upstreamOf(config.frontendUrl)],
    responseHeaders: panelHeadersFor(true),
  });
};

export const applyDashboardDomain = async (domain: string) => {
  const current = await getDashboardDocument();

  try {
    await applyDashboardRoutes(domain);

    await dashboardModel.updateOne(
      { _id: current._id },
      {
        $set: { status: domain ? 'pending' : 'disabled', appliedAt: new Date() },
        $unset: { lastError: '' },
      },
    );

    logInfo('Dashboard domain applied', { domain: domain || '(default)' });
  } catch (error) {
    const message = errorMessage(error);

    await dashboardModel.updateOne(
      { _id: current._id },
      { $set: { status: 'error', lastError: message } },
    );

    logWarn('Could not apply the dashboard domain on the proxy', {
      domain: domain || '(default)',
      error: message,
    });

    invalidatePublicUrlCache();

    throw error;
  }

  invalidatePublicUrlCache();

  return getDashboardDocument();
};

export const refreshDashboardCertificate = async () => {
  const current = await getDashboardDocument();

  if (!current.domain || current.status !== 'pending') {
    return current;
  }

  const proxy = await resolveProxy();
  const certificate = await proxy.getCertificateStatus(current.domain);

  if (!certificate.valid) {
    return current;
  }

  await dashboardModel.updateOne(
    { _id: current._id },
    {
      $set: {
        status: 'active',
        certificateIssuer: certificate.issuer,
        certificateExpiresAt: certificate.expiresAt ? new Date(certificate.expiresAt) : undefined,
      },
    },
  );

  invalidatePublicUrlCache();

  return getDashboardDocument();
};

export const ensureDashboardRoutes = async () => {
  const document = await getDashboardDocument();
  const domain = document.domain;

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
