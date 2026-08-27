import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const routeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    domain: { type: 'string' },
    isDefault: { type: 'boolean' },
    pathPrefix: { type: 'string' },
    tls: { type: 'boolean' },
    upstreams: {
      type: 'array',
      items: {
        type: 'object',
        properties: { host: { type: 'string' }, port: { type: 'integer' } },
      },
    },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
  },
};

const certificateSchema = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    valid: { type: 'boolean' },
    issuer: { type: 'string' },
    issuedAt: { type: 'string' },
    expiresAt: { type: 'string' },
  },
};

export const proxyDocs = {
  list: {
    tags: ['Proxy'],
    summary: 'List the routes managed by Zydock',
    security: agentAuth,
    responses: {
      200: jsonRes('Routes.', { type: 'array', items: routeSchema }),
      401: errorRes('Invalid agent token.'),
    },
  },
  get: {
    tags: ['Proxy'],
    summary: 'Read a route',
    security: agentAuth,
    responses: { 200: jsonRes('Route.', routeSchema), 404: errorRes('Route not found.') },
  },
  upsert: {
    tags: ['Proxy'],
    summary: 'Create or replace a route',
    description:
      'Idempotent: the route id is stable, so applying the same specification twice leaves a ' +
      'single route. Creates the Zydock server inside the proxy configuration on first use. A ' +
      'new route with a domain is inserted first, ahead of any existing route; a new default ' +
      'route (isDefault, no domain) is appended last, so it never shadows a domain route. Every ' +
      'applied route is served with zstd/gzip compression for textual content types; ' +
      'text/event-stream responses and WebSocket connections are never compressed.',
    security: agentAuth,
    responses: {
      200: messageRes('Route applied.'),
      400: errorRes('The proxy refused the configuration.'),
    },
  },
  remove: {
    tags: ['Proxy'],
    summary: 'Remove a route',
    description: 'Idempotent: removing an unknown route succeeds.',
    security: agentAuth,
    responses: { 200: messageRes('Route removed.'), 400: errorRes('Operation failed.') },
  },
  enableTls: {
    tags: ['Proxy'],
    summary: 'Let the proxy manage HTTPS for a domain',
    security: agentAuth,
    responses: { 200: messageRes('TLS enabled.'), 400: errorRes('Operation failed.') },
  },
  certificate: {
    tags: ['Proxy'],
    summary: 'Certificate served for a domain',
    description:
      'Opens a TLS connection to the local proxy with the domain as SNI and reads the ' +
      'certificate it serves. Never throws: an unreachable proxy answers `valid: false`.',
    security: agentAuth,
    responses: { 200: jsonRes('Certificate status.', certificateSchema) },
  },
  renew: {
    tags: ['Proxy'],
    summary: 'Re-evaluate the certificate of a domain',
    description:
      'The proxy renews certificates on its own and exposes no way to force it. This re-applies ' +
      'the configuration, which obtains a missing or expiring certificate right away.',
    security: agentAuth,
    responses: { 200: messageRes('Certificate re-evaluated.'), 400: errorRes('Operation failed.') },
  },
  reload: {
    tags: ['Proxy'],
    summary: 'Re-apply the current configuration',
    security: agentAuth,
    responses: { 200: messageRes('Proxy reloaded.'), 400: errorRes('Operation failed.') },
  },
} satisfies Record<string, DocOptions>;
