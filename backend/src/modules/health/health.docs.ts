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
    panelName: { type: 'string' },
    role: { type: 'string', enum: ['active', 'standby'] },
    dataFrom: { type: 'string', format: 'date-time' },
    uptime: { type: 'integer' },
    timestamp: { type: 'string', format: 'date-time' },
    autoDomain: {
      type: 'object',
      description: 'Whether automatic domains are enabled, and the suffix used to build them.',
      properties: {
        enabled: { type: 'boolean' },
        suffix: { type: 'string' },
      },
    },
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
      'Returns the API status, the installed version and commit, the panel name, its ' +
      'active/standby role, uptime and the state of its dependencies. Anonymous — used by the ' +
      'login screen and the sidebar to show the panel name before authentication, and by other ' +
      'installations to check whether this one is demoted before a promotion.',
    responses: {
      200: jsonRes('The API and all its dependencies are healthy.', healthSchema),
      503: jsonRes('At least one dependency is unavailable.', healthSchema),
    },
  },
} satisfies Record<string, DocOptions>;
