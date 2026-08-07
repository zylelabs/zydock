import type { DocOptions } from 'hono-route-docs';
import { jsonRes } from '../../utils/openapi';

const dependencySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['up', 'down'] },
    state: { type: 'string' },
    clients: { type: 'integer' },
  },
};

const healthSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    version: { type: 'string' },
    commit: { type: 'string' },
    uptime: { type: 'integer' },
    timestamp: { type: 'string', format: 'date-time' },
    dependencies: {
      type: 'object',
      properties: {
        database: dependencySchema,
        websocket: dependencySchema,
      },
    },
  },
};

export const healthDocs = {
  check: {
    tags: ['Health'],
    summary: 'Health check',
    description:
      'Returns the API status, the installed version and commit, uptime and the state of its dependencies.',
    responses: {
      200: jsonRes('The API and all its dependencies are healthy.', healthSchema),
      503: jsonRes('At least one dependency is unavailable.', healthSchema),
    },
  },
} satisfies Record<string, DocOptions>;
