import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes } from '../../utils/openapi';

export const metricsDocs = {
  system: {
    tags: ['Metrics'],
    summary: 'System metrics',
    description:
      'CPU, memory, disk, uptime and container counters. Served from a short-lived local cache, ' +
      'so repeated calls do not hammer the host.',
    security: agentAuth,
    responses: {
      200: jsonRes('System metrics.', {
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
      }),
      401: errorRes('Invalid agent token.'),
    },
  },
  containers: {
    tags: ['Metrics'],
    summary: 'Per-container metrics',
    security: agentAuth,
    responses: {
      200: jsonRes('Container metrics.', {
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
      }),
      401: errorRes('Invalid agent token.'),
    },
  },
} satisfies Record<string, DocOptions>;
