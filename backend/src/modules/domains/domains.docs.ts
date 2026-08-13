import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const domainSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    applicationId: { type: 'string' },
    serverId: { type: 'string' },
    hostname: { type: 'string' },
    pathPrefix: { type: 'string', nullable: true },
    tls: { type: 'boolean' },
    auto: { type: 'boolean' },
    status: { type: 'string', enum: ['pending', 'active', 'error'] },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const certificateSchema = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    valid: { type: 'boolean' },
    issuer: { type: 'string', nullable: true },
    issuedAt: { type: 'string', nullable: true },
    expiresAt: { type: 'string', nullable: true },
  },
};

const unreachable = errorRes('The agent of the server could not be reached.');

export const domainsDocs = {
  list: {
    tags: ['Domains'],
    summary: 'List the domains of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'applicationId', in: 'query', schema: { type: 'string' } }],
    responses: {
      200: jsonRes('Domains.', paginatedSchema(domainSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Domains'],
    summary: 'Attach a domain to an application',
    description:
      'Registers a hostname for an application and tries to configure it on the server proxy right ' +
      'away. If the container or the proxy is not ready, the domain is stored as `pending`/`error` ' +
      'and the next deploy (or an explicit apply) configures it. HTTPS is automatic via the proxy ' +
      "(Let's Encrypt) when `tls` is true. A hostname is unique across the platform.",
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Domain created.', { type: 'object', properties: { domain: domainSchema } }),
      400: errorRes('Invalid body, or the application is not in this organization.'),
      409: errorRes('The hostname is already in use.'),
    },
  },
  get: {
    tags: ['Domains'],
    summary: 'Read a domain',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Domain.', { type: 'object', properties: { domain: domainSchema } }),
      404: errorRes('Domain not found.'),
    },
  },
  update: {
    tags: ['Domains'],
    summary: 'Update a domain',
    description:
      'Changes the path prefix or TLS flag and re-applies the route. The hostname is immutable — ' +
      'remove the domain and create a new one to change it.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Domain updated.', { type: 'object', properties: { domain: domainSchema } }),
      404: errorRes('Domain not found.'),
    },
  },
  remove: {
    tags: ['Domains'],
    summary: 'Remove a domain',
    description:
      'Removes the route from the proxy and deletes the domain. Removing an automatic domain ' +
      '(`auto: true`) marks the application so it is not recreated on the next deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Domain removed.'),
      404: errorRes('Domain not found.'),
    },
  },
  apply: {
    tags: ['Domains'],
    summary: 'Configure the domain on the proxy now',
    description: 'Upserts the route and enables automatic HTTPS, without waiting for a deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Domain applied.', { type: 'object', properties: { domain: domainSchema } }),
      404: errorRes('Domain not found.'),
      502: unreachable,
    },
  },
  certificate: {
    tags: ['Domains'],
    summary: 'Certificate the proxy serves for the domain',
    description:
      'Opens a TLS connection to the proxy using the hostname as SNI; no external DNS needed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Certificate status.', certificateSchema),
      404: errorRes('Domain not found.'),
      502: unreachable,
    },
  },
  renew: {
    tags: ['Domains'],
    summary: 'Reapply the domain configuration to trigger renewal',
    description:
      "The proxy renews certificates on its own; this reapplies the domain's configuration for the " +
      'cases where a nudge is wanted.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Renewal requested.'),
      404: errorRes('Domain not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
