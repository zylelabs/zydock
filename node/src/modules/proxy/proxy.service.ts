import { connect } from 'node:tls';
import config from '../../config';
import { errorMessage } from '../../utils';
import { logInfo } from '../../utils/logger';
import type { RouteSpecDTO } from './proxy.schema';

/** Name of the HTTP server Zydock owns inside the Caddy config. */
const SERVER_NAME = 'zydock';
const ROUTE_ID_PREFIX = 'zydock-route-';
const PROBE_TIMEOUT_MS = 5000;

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
  }[];
  terminal?: boolean;
};

type CaddyConfig = {
  apps?: {
    http?: { servers?: Record<string, { listen?: string[]; routes?: CaddyRoute[] }> };
    tls?: { automation?: { policies?: { subjects?: string[] }[] } };
  };
};

const routeIdOf = (id: string) => `${ROUTE_ID_PREFIX}${id}`;

/** Certificate fields carry either a single value or every occurrence of the attribute. */
const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const request = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const { method = 'GET', body } = init;

  let response: Response;

  try {
    response = await fetch(`${config.proxy.adminUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
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
    } catch {
      // Caddy answers with plain text on some failures; the raw body is the message.
    }

    throw new Error(`Caddy admin API refused ${method} ${path}: ${message}`);
  }

  return response;
};

/**
 * Reads the whole configuration. Caddy refuses to traverse a path whose parent does not exist
 * (`invalid traversal path at: config/apps/tls`), so every read starts from the root and walks the
 * object in memory.
 */
const readConfig = async (): Promise<CaddyConfig> => {
  const body = (await (await request('/config/')).text()).trim();

  if (!body || body === 'null') {
    return {};
  }

  return JSON.parse(body) as CaddyConfig;
};

const load = (configuration: CaddyConfig) =>
  request('/load', { method: 'POST', body: configuration });

const toCaddyRoute = (spec: RouteSpec): CaddyRoute => {
  const headers = Object.entries(spec.headers ?? {});

  return {
    '@id': routeIdOf(spec.id),
    match: [
      {
        host: [spec.domain],
        ...(spec.pathPrefix ? { path: [`${spec.pathPrefix.replace(/\*$/, '')}*`] } : {}),
      },
    ],
    handle: [
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

const fromCaddyRoute = (route: CaddyRoute, managedDomains: string[]): RouteSpec | null => {
  const id = route['@id'];

  if (!id?.startsWith(ROUTE_ID_PREFIX)) {
    return null;
  }

  const match = route.match?.[0];
  const handle = route.handle?.find(entry => entry.handler === 'reverse_proxy');
  const domain = match?.host?.[0] ?? '';
  const path = match?.path?.[0];
  const headers = Object.entries(handle?.headers?.request?.set ?? {});

  return {
    id: id.slice(ROUTE_ID_PREFIX.length),
    domain,
    upstreams: (handle?.upstreams ?? []).flatMap(upstream => {
      const dial = upstream.dial ?? '';
      const separator = dial.lastIndexOf(':');

      if (separator <= 0) {
        return [];
      }

      return [{ host: dial.slice(0, separator), port: Number(dial.slice(separator + 1)) }];
    }),
    ...(path ? { pathPrefix: path.replace(/\*$/, '') } : {}),
    tls: managedDomains.includes(domain),
    ...(headers.length
      ? { headers: Object.fromEntries(headers.map(([key, value]) => [key, value[0] ?? ''])) }
      : {}),
  };
};

/** Creates the Zydock HTTP server inside the Caddy config the first time it is needed. */
const ensureServer = async () => {
  const current = await readConfig();
  const servers = current.apps?.http?.servers ?? {};

  if (servers[SERVER_NAME]) {
    return current;
  }

  const next: CaddyConfig = {
    ...current,
    apps: {
      ...current.apps,
      http: {
        ...current.apps?.http,
        servers: { ...servers, [SERVER_NAME]: { listen: [':80', ':443'], routes: [] } },
      },
    },
  };

  await load(next);
  logInfo('Caddy server created', { server: SERVER_NAME });

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
  } else {
    await request(`/config/apps/http/servers/${SERVER_NAME}/routes`, {
      method: 'POST',
      body: payload,
    });
  }

  if (spec.tls) {
    await enableTls(spec.domain);
  }

  logInfo('Proxy route applied', { route: spec.id, domain: spec.domain });
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

/** Adds the domain to the TLS automation policies, so Caddy issues and renews its certificate. */
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

/**
 * Reads the certificate the local proxy actually serves for the domain. Probing through SNI on
 * this host — instead of resolving the domain publicly — reports what the proxy has, without
 * depending on external DNS.
 */
export const getCertificateStatus = (domain: string) =>
  new Promise<CertificateStatus>(resolve => {
    const socket = connect(
      {
        host: '127.0.0.1',
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

/**
 * Caddy renews certificates on its own and exposes no endpoint to force it. Re-applying the
 * configuration makes it evaluate the domain again, which obtains a missing or expiring
 * certificate right away — an already valid one is kept.
 */
export const renewCertificate = async (domain: string) => {
  await enableTls(domain);
  await reload();

  logInfo('Certificate re-evaluated', { domain });
};

export const reload = async () => {
  await load(await readConfig());
};
