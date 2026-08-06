import type { DocOptions, OpenAPIParameter } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';

const accessEntrySchema = {
  type: 'object',
  properties: {
    at: { type: 'string' },
    host: { type: 'string' },
    method: { type: 'string' },
    path: { type: 'string' },
    status: { type: 'integer' },
    durationMs: { type: 'number' },
    remoteIp: { type: 'string' },
    userAgent: { type: 'string', nullable: true },
    size: { type: 'integer' },
    applicationId: { type: 'string', nullable: true },
    applicationName: { type: 'string', nullable: true },
    domainId: { type: 'string', nullable: true },
    organizationId: { type: 'string', nullable: true },
    unmatched: { type: 'boolean' },
  },
};

const accessPageSchema = {
  type: 'object',
  properties: {
    ...paginatedSchema(accessEntrySchema).properties,
    filtered: {
      type: 'boolean',
      description:
        'True when the caller is not a superuser and hosts of other organizations were removed.',
    },
  },
};

const queryParameters: OpenAPIParameter[] = [
  { name: 'host', in: 'query', schema: { type: 'string' } },
  { name: 'since', in: 'query', schema: { type: 'string' } },
  { name: 'tail', in: 'query', schema: { type: 'integer' } },
  { name: 'status', in: 'query', schema: { type: 'integer' } },
];

const listQueryParameters: OpenAPIParameter[] = [
  ...queryParameters,
  { name: 'page', in: 'query', schema: { type: 'integer' } },
  { name: 'size', in: 'query', schema: { type: 'integer' } },
];

const statsQueryParameters: OpenAPIParameter[] = [
  {
    name: 'minutes',
    in: 'query',
    schema: { type: 'integer' },
    description: 'Size of the window to aggregate, in minutes. Defaults to 60.',
  },
];

const statsSchema = {
  type: 'object',
  properties: {
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          minute: { type: 'string' },
          requests: { type: 'integer' },
          errorRate: { type: 'number' },
          p95Ms: { type: 'number' },
        },
      },
    },
    topHosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          applicationId: { type: 'string', nullable: true },
          applicationName: { type: 'string', nullable: true },
          requests: { type: 'integer' },
        },
      },
    },
    filtered: { type: 'boolean' },
  },
};

const unreachable = errorRes('The agent of this server could not be reached.');

const notProvisioned = errorRes('This server has no agent yet.');

export const proxyDocs = {
  serverList: {
    tags: ['Proxy'],
    summary: 'Access log of every request the proxy of this server handled',
    description:
      'All traffic through the proxy of this server, across every application, including ' +
      'requests that matched no route (`unmatched: true`). A non-superuser sees only the hosts ' +
      'of their own organization — the response comes back with `filtered: true`.',
    security: bearerOrApiKeyAuth,
    parameters: listQueryParameters,
    responses: {
      200: jsonRes('Access log entries.', accessPageSchema),
      404: errorRes('Server not found.'),
      409: notProvisioned,
      502: unreachable,
    },
  },
  serverStream: {
    tags: ['Proxy'],
    summary: 'Live access log of this server, one entry per request',
    description:
      'Same scope and filtering as the list endpoint, as a `text/event-stream`. `log` events carry ' +
      'one entry; a `ping` event every few seconds keeps the connection alive. Stops when the ' +
      'client disconnects.',
    security: bearerOrApiKeyAuth,
    parameters: queryParameters,
    responses: {
      200: { description: 'Event stream of access log entries.' },
      404: errorRes('Server not found.'),
      409: notProvisioned,
      502: unreachable,
    },
  },
  serverStats: {
    tags: ['Proxy'],
    summary: 'Requests/minute, error rate and p95 duration for the proxy of this server',
    description:
      'Built from the (host, minute) counters written by the agent in batches — never from raw ' +
      'requests. Includes a ranking of the most requested hosts in the window. A non-superuser ' +
      'sees only the hosts of their own organization — `filtered: true`.',
    security: bearerOrApiKeyAuth,
    parameters: statsQueryParameters,
    responses: {
      200: jsonRes('Aggregated access statistics.', statsSchema),
      404: errorRes('Server not found.'),
    },
  },
  applicationList: {
    tags: ['Proxy'],
    summary: 'Access log of the requests routed to this application',
    description: 'The same data as the server view, filtered to the hostnames of this application.',
    security: bearerOrApiKeyAuth,
    parameters: listQueryParameters,
    responses: {
      200: jsonRes('Access log entries.', accessPageSchema),
      404: errorRes('Application not found.'),
      409: notProvisioned,
      502: unreachable,
    },
  },
  applicationStream: {
    tags: ['Proxy'],
    summary: 'Live access log of this application, one entry per request',
    description: 'Same scope as the list endpoint, as a `text/event-stream`.',
    security: bearerOrApiKeyAuth,
    parameters: queryParameters,
    responses: {
      200: { description: 'Event stream of access log entries.' },
      404: errorRes('Application not found.'),
      409: notProvisioned,
      502: unreachable,
    },
  },
  applicationStats: {
    tags: ['Proxy'],
    summary: 'Requests/minute, error rate and p95 duration for this application',
    description:
      "Same aggregated data as the server view, filtered to this application's hostnames.",
    security: bearerOrApiKeyAuth,
    parameters: statsQueryParameters,
    responses: {
      200: jsonRes('Aggregated access statistics.', statsSchema),
      404: errorRes('Application not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
