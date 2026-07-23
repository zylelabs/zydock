import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';

const systemMetricsSchema = {
  type: 'object',
  properties: {
    cpuPercent: { type: 'number', nullable: true },
    memoryUsedMb: { type: 'integer' },
    memoryTotalMb: { type: 'integer' },
    diskUsedGb: { type: 'number', nullable: true },
    diskTotalGb: { type: 'number', nullable: true },
    networkRxBytes: { type: 'integer', nullable: true },
    networkTxBytes: { type: 'integer', nullable: true },
    uptimeSeconds: { type: 'integer' },
    containersRunning: { type: 'integer' },
    containersTotal: { type: 'integer' },
  },
};

const containerMetricsSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      cpuPercent: { type: 'number' },
      memoryUsedMb: { type: 'number' },
      memoryLimitMb: { type: 'number' },
    },
  },
};

const applicationMetricsSchema = {
  type: 'object',
  nullable: true,
  properties: {
    containerId: { type: 'string' },
    name: { type: 'string' },
    state: { type: 'string' },
    health: { type: 'string' },
    restartCount: { type: 'integer' },
    uptimeSeconds: { type: 'integer', nullable: true },
    cpuPercent: { type: 'number' },
    memoryUsedMb: { type: 'number' },
    memoryLimitMb: { type: 'number' },
  },
};

const unreachable = errorRes('The agent of the server could not be reached.');

export const metricsDocs = {
  server: {
    tags: ['Metrics'],
    summary: 'Live system metrics of a server',
    description:
      'CPU, memory, disk, network and container counters, read from the agent now. Real-time ' +
      'streaming is the WebSocket topic `server:<id>:metrics`.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('System metrics.', systemMetricsSchema),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  serverContainers: {
    tags: ['Metrics'],
    summary: 'Live per-container metrics of a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Container metrics.', containerMetricsSchema),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  history: {
    tags: ['Metrics'],
    summary: 'History of a server’s system metrics',
    description:
      'Samples recorded from the heartbeat, most recent first. Retention is bounded by a TTL; ' +
      'network counters are cumulative, so take deltas to get a rate.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } },
    ],
    responses: {
      200: jsonRes('Samples.', {
        type: 'object',
        properties: {
          items: { type: 'array', items: { ...systemMetricsSchema } },
        },
      }),
      404: errorRes('Server not found.'),
    },
  },
  application: {
    tags: ['Metrics'],
    summary: 'Live metrics of an application',
    description:
      'CPU, memory, restarts, uptime and health of the container running the application now, or ' +
      '`null` when none is running. Real-time streaming is the topic `application:<id>:metrics`.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Application metrics.', applicationMetricsSchema),
      404: errorRes('Application not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  deployments: {
    tags: ['Metrics'],
    summary: 'Deploy metrics of an application',
    description:
      'Aggregated over the last 100 deployments: counts, success rate, build and total times.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Deploy metrics.', {
        type: 'object',
        properties: {
          window: { type: 'integer' },
          succeeded: { type: 'integer' },
          failed: { type: 'integer' },
          successRate: { type: 'integer', nullable: true },
          averageDurationMs: { type: 'integer', nullable: true },
          averageBuildMs: { type: 'integer', nullable: true },
          last: { type: 'object', nullable: true },
        },
      }),
      404: errorRes('Application not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
