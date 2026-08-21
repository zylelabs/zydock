import { connect } from 'node:tls';
import config from '../../config';
import { errorMessage } from '../../utils';
import { logInfo } from '../../utils/logger';
import type { RouteSpecDTO } from './proxy.schema';

const SERVER_NAME = 'zydock';
const ROUTE_ID_PREFIX = 'zydock-route-';
const PROBE_TIMEOUT_MS = 5000;
const UNIX_SCHEME = 'unix:';

export type RouteSpec = RouteSpecDTO & { id: string };

export type CertificateStatus = {
  domain: string;
  valid: boolean;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
};

type CaddyRoute = {
  '@id'?: string;
  match?: { host?: string[]; path?: string[] }[];
  handle?: {
    handler?: string;
    upstreams?: { dial?: string }[];
    headers?: { request?: { set?: Record<string, string[]> } };
    response?: { set?: Record<string, string[]> };
  }[];
  terminal?: boolean;
};

type CaddyServer = {
  listen?: string[];
  routes?: CaddyRoute[];
  logs?: Record<string, never>;
};

type CaddyConfig = {
  admin?: { listen?: string };
  apps?: {
    http?: { servers?: Record<string, CaddyServer> };
    tls?: { automation?: { policies?: { subjects?: string[] }[] } };
  };
};

const routeIdOf = (id: string) => `${ROUTE_ID_PREFIX}${id}`;

const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const socketPath = config.proxy.adminUrl.startsWith(UNIX_SCHEME)
  ? config.proxy.adminUrl.slice(UNIX_SCHEME.length)
  : undefined;

const adminBaseUrl = socketPath ? 'http://localhost' : config.proxy.adminUrl;

const request = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const { method = 'GET', body } = init;

  let response: Response;

  try {
    response = await fetch(`${adminBaseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ...(socketPath ? { unix: socketPath } : {}),
    });
  } catch (error) {
    throw new Error(`Caddy admin API did not answer ${method} ${path}: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text();

    let message = detail.trim() || `HTTP ${response.status}`;

    try {
      const parsed = JSON.parse(detail) as { error?: unknown };

      if (typeof parsed.error === 'string') {
        message = parsed.error;
      }
    } catch {}

    throw new Error(`Caddy admin API refused ${method} ${path}: ${message}`);
  }

  return response;
};

const readConfig = async (): Promise<CaddyConfig> => {
  const body = (await (await request('/config/')).text()).trim();

  if (!body || body === 'null') {
    return {};
  }

  return JSON.parse(body) as CaddyConfig;
};

const load = (configuration: CaddyConfig) =>
  request('/load', {
    method: 'POST',
    body: socketPath
      ? { ...configuration, admin: { listen: `unix/${socketPath}` } }
      : configuration,
  });

export const toCaddyRoute = (spec: RouteSpec): CaddyRoute => {
  const headers = Object.entries(spec.headers ?? {});
  const responseHeaders = Object.entries(spec.responseHeaders ?? {});
  const path = spec.pathPrefix ? [`${spec.pathPrefix.replace(/\*$/, '')}*`] : undefined;
  const match = spec.domain
    ? [{ host: [spec.domain], ...(path ? { path } : {}) }]
    : path
      ? [{ path }]
      : undefined;

  return {
    '@id': routeIdOf(spec.id),
    ...(match ? { match } : {}),
    handle: [
      ...(responseHeaders.length
        ? [
            {
              handler: 'headers',
              response: {
                set: Object.fromEntries(responseHeaders.map(([key, value]) => [key, [value]])),
              },
            },
          ]
        : []),
      {
        handler: 'reverse_proxy',
        upstreams: spec.upstreams.map(upstream => ({ dial: `${upstream.host}:${upstream.port}` })),
        ...(headers.length
          ? {
              headers: {
                request: { set: Object.fromEntries(headers.map(([key, value]) => [key, [value]])) },
              },
            }
          : {}),
      },
    ],
    terminal: true,
  };
};

export const fromCaddyRoute = (route: CaddyRoute, managedDomains: string[]): RouteSpec | null => {
  const id = route['@id'];

  if (!id?.startsWith(ROUTE_ID_PREFIX)) {
    return null;
  }

  const match = route.match?.[0];
  const handle = route.handle?.find(entry => entry.handler === 'reverse_proxy');
  const headersHandle = route.handle?.find(entry => entry.handler === 'headers');
  const domain = match?.host?.[0];
  const path = match?.path?.[0];
  const headers = Object.entries(handle?.headers?.request?.set ?? {});
  const responseHeaders = Object.entries(headersHandle?.response?.set ?? {});

  return {
    id: id.slice(ROUTE_ID_PREFIX.length),
    ...(domain ? { domain } : { isDefault: true }),
    upstreams: (handle?.upstreams ?? []).flatMap(upstream => {
      const dial = upstream.dial ?? '';
      const separator = dial.lastIndexOf(':');

      if (separator <= 0) {
        return [];
      }

      return [{ host: dial.slice(0, separator), port: Number(dial.slice(separator + 1)) }];
    }),
    ...(path ? { pathPrefix: path.replace(/\*$/, '') } : {}),
    tls: domain ? managedDomains.includes(domain) : false,
    ...(headers.length
      ? { headers: Object.fromEntries(headers.map(([key, value]) => [key, value[0] ?? ''])) }
      : {}),
    ...(responseHeaders.length
      ? {
          responseHeaders: Object.fromEntries(
            responseHeaders.map(([key, value]) => [key, value[0] ?? '']),
          ),
        }
      : {}),
  };
};

const ensureServer = async () => {
  const current = await readConfig();
  const servers = current.apps?.http?.servers ?? {};
  const server = servers[SERVER_NAME];

  if (server?.logs) {
    return current;
  }

  const next: CaddyConfig = {
    ...current,
    apps: {
      ...current.apps,
      http: {
        ...current.apps?.http,
        servers: {
          ...servers,
          [SERVER_NAME]: { listen: [':80', ':443'], routes: [], ...server, logs: {} },
        },
      },
    },
  };

  await load(next);
  logInfo(server ? 'Caddy access logging enabled' : 'Caddy server created', {
    server: SERVER_NAME,
  });

  return next;
};

const routesOf = (configuration: CaddyConfig) =>
  configuration.apps?.http?.servers?.[SERVER_NAME]?.routes ?? [];

const managedDomainsOf = (configuration: CaddyConfig) =>
  (configuration.apps?.tls?.automation?.policies ?? []).flatMap(policy => policy.subjects ?? []);

export const upsertRoute = async (spec: RouteSpec) => {
  const current = await ensureServer();

  const exists = routesOf(current).some(route => route['@id'] === routeIdOf(spec.id));
  const payload = toCaddyRoute(spec);

  if (exists) {
    await request(`/id/${routeIdOf(spec.id)}`, { method: 'PATCH', body: payload });
  } else if (spec.isDefault) {
    await request(`/config/apps/http/servers/${SERVER_NAME}/routes`, {
      method: 'POST',
      body: payload,
    });
  } else {
    await request(`/config/apps/http/servers/${SERVER_NAME}/routes/0`, {
      method: 'PUT',
      body: payload,
    });
  }

  if (spec.tls && spec.domain) {
    await enableTls(spec.domain);
  }

  logInfo('Proxy route applied', { route: spec.id, domain: spec.domain ?? '(default)' });
};

export const removeRoute = async (id: string) => {
  const current = await readConfig();

  if (!routesOf(current).some(route => route['@id'] === routeIdOf(id))) {
    return;
  }

  await request(`/id/${routeIdOf(id)}`, { method: 'DELETE' });
  logInfo('Proxy route removed', { route: id });
};

export const listRoutes = async (): Promise<RouteSpec[]> => {
  const current = await readConfig();
  const managedDomains = managedDomainsOf(current);

  return routesOf(current).flatMap(route => {
    const spec = fromCaddyRoute(route, managedDomains);

    return spec ? [spec] : [];
  });
};

export const getRoute = async (id: string) =>
  (await listRoutes()).find(route => route.id === id) ?? null;

export const enableTls = async (domain: string) => {
  const current = await ensureServer();
  const policies = current.apps?.tls?.automation?.policies ?? [];

  if (policies.some(policy => policy.subjects?.includes(domain))) {
    return;
  }

  await load({
    ...current,
    apps: {
      ...current.apps,
      tls: {
        ...current.apps?.tls,
        automation: {
          ...current.apps?.tls?.automation,
          policies: [...policies, { subjects: [domain] }],
        },
      },
    },
  });

  logInfo('TLS enabled for domain', { domain });
};

export const getCertificateStatus = (domain: string) =>
  new Promise<CertificateStatus>(resolve => {
    const socket = connect(
      {
        host: config.proxy.httpsHost,
        port: config.proxy.httpsPort,
        servername: domain,
        rejectUnauthorized: false,
      },
      () => {
        const certificate = socket.getPeerCertificate();

        socket.end();

        if (!certificate?.valid_to) {
          resolve({ domain, valid: false });
          return;
        }

        const issuedAt = new Date(certificate.valid_from);
        const expiresAt = new Date(certificate.valid_to);
        const now = Date.now();

        resolve({
          domain,
          valid: now >= issuedAt.getTime() && now <= expiresAt.getTime(),
          issuer: firstValue(certificate.issuer?.CN) ?? firstValue(certificate.issuer?.O),
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      },
    );

    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      resolve({ domain, valid: false });
    });

    socket.on('error', () => resolve({ domain, valid: false }));
  });

export const renewCertificate = async (domain: string) => {
  await enableTls(domain);
  await reload();

  logInfo('Certificate re-evaluated', { domain });
};

export const reload = async () => {
  await load(await readConfig());
};
