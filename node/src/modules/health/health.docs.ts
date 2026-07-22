import type { DocOptions } from 'hono-route-docs';
import { jsonRes } from '../../utils/openapi';

const healthSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptime: { type: 'integer' },
    timestamp: { type: 'string', format: 'date-time' },
    dependencies: {
      type: 'object',
      properties: {
        docker: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['up', 'down'] },
            containers: { type: 'integer' },
          },
        },
      },
    },
    autoheal: { type: 'object', properties: { restarts: { type: 'integer' } } },
  },
};

export const healthDocs = {
  check: {
    tags: ['Health'],
    summary: 'Agent health check',
    description:
      'Returns the agent status, uptime, the state of the container runtime and how many ' +
      'containers auto-heal has restarted. Public, so the provisioning step can verify it.',
    responses: {
      200: jsonRes('The agent and the container runtime are healthy.', healthSchema),
      503: jsonRes('The container runtime is unavailable.', healthSchema),
    },
  },
} satisfies Record<string, DocOptions>;
