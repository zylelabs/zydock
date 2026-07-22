import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';

const logEntrySchema = {
  type: 'object',
  properties: {
    timestamp: { type: 'string' },
    stream: { type: 'string', enum: ['stdout', 'stderr'] },
    message: { type: 'string' },
    level: { type: 'string', enum: ['error', 'warn', 'info'] },
  },
};

const filterParameters = [
  {
    name: 'search',
    in: 'query' as const,
    description: 'Case-insensitive substring; only matching lines are returned.',
    schema: { type: 'string' },
  },
  { name: 'stream', in: 'query' as const, schema: { type: 'string', enum: ['stdout', 'stderr'] } },
  {
    name: 'level',
    in: 'query' as const,
    schema: { type: 'string', enum: ['error', 'warn', 'info'] },
  },
  { name: 'since', in: 'query' as const, schema: { type: 'string' } },
  { name: 'until', in: 'query' as const, schema: { type: 'string' } },
  { name: 'tail', in: 'query' as const, schema: { type: 'integer', default: 200 } },
];

const unreachable = errorRes('The agent of the server could not be reached.');

export const logsDocs = {
  list: {
    tags: ['Logs'],
    summary: 'Read the logs of an application',
    description:
      'History is the retained output of the container running the application now, fetched from ' +
      'the agent. `since`, `until` and `tail` are applied at the source; `search`, `stream` and ' +
      '`level` filter what comes back. Each line carries a `level` so errors and warnings can be ' +
      'highlighted. When the application has no container running, `containerId` is `null` and ' +
      '`entries` is empty. Real-time follow is the WebSocket topic `application:<id>:logs`.',
    security: bearerOrApiKeyAuth,
    parameters: filterParameters,
    responses: {
      200: jsonRes('Logs.', {
        type: 'object',
        properties: {
          containerId: { type: 'string', nullable: true },
          entries: { type: 'array', items: logEntrySchema },
        },
      }),
      404: errorRes('Application not found.'),
      502: unreachable,
    },
  },
  download: {
    tags: ['Logs'],
    summary: 'Download the logs of an application',
    description: 'Same filters as the listing, returned as a `text/plain` attachment.',
    security: bearerOrApiKeyAuth,
    parameters: filterParameters,
    responses: {
      200: {
        description: 'Log file.',
        content: { 'text/plain': { schema: { type: 'string' } } },
      },
      404: errorRes('Application not found.'),
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
