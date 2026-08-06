import type { DocOptions, OpenAPIParameter } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes } from '../../utils/openapi';

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
    userAgent: { type: 'string' },
    size: { type: 'integer' },
  },
};

const queryParameters: OpenAPIParameter[] = [
  { name: 'host', in: 'query', schema: { type: 'string' } },
  { name: 'since', in: 'query', schema: { type: 'string' } },
  { name: 'tail', in: 'query', schema: { type: 'integer' } },
  { name: 'status', in: 'query', schema: { type: 'integer' } },
];

export const proxyAccessDocs = {
  list: {
    tags: ['Proxy'],
    summary: 'Access log entries read from the proxy container',
    description:
      'Reads the tail of the proxy container log, keeps only `http.log.access` lines and ' +
      'normalizes them. Bounded by `tail`, never reads the whole log.',
    security: agentAuth,
    parameters: [
      ...queryParameters,
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Access log entries.', {
        type: 'object',
        properties: {
          items: { type: 'array', items: accessEntrySchema },
          total: { type: 'integer' },
          page: { type: 'integer' },
          size: { type: 'integer' },
          pages: { type: 'integer' },
        },
      }),
      401: errorRes('Invalid agent token.'),
    },
  },
  stream: {
    tags: ['Proxy'],
    summary: 'Live access log, one entry per request',
    description:
      'A `text/event-stream` of `log` events, each carrying one normalized access log entry. A ' +
      '`ping` event every few seconds keeps a quiet proxy from having its connection closed for ' +
      'being idle. The stream stops when the client disconnects.',
    security: agentAuth,
    parameters: queryParameters,
    responses: {
      200: { description: 'Event stream of access log entries.' },
      401: errorRes('Invalid agent token.'),
    },
  },
} satisfies Record<string, DocOptions>;
