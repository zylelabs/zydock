import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const containerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    image: { type: 'string' },
    state: { type: 'string' },
    health: { type: 'string' },
    startedAt: { type: 'string', nullable: true },
    restartCount: { type: 'integer' },
    labels: { type: 'object', additionalProperties: { type: 'string' } },
    protected: { type: 'boolean' },
  },
};

const protectedRes = errorRes(
  'The container is part of the Zydock platform and cannot be changed.',
);

export const containersDocs = {
  list: {
    tags: ['Containers'],
    summary: 'List containers',
    security: agentAuth,
    parameters: [
      { name: 'state', in: 'query', schema: { type: 'string' } },
      { name: 'namePrefix', in: 'query', schema: { type: 'string' } },
      {
        name: 'label',
        in: 'query',
        description: 'One `key=value` pair; repeat the parameter to filter by several labels.',
        schema: { type: 'array', items: { type: 'string' } },
      },
    ],
    responses: {
      200: jsonRes('Containers.', { type: 'array', items: containerSchema }),
      401: errorRes('Invalid agent token.'),
    },
  },
  create: {
    tags: ['Containers'],
    summary: 'Create a container',
    security: agentAuth,
    responses: {
      201: jsonRes('Container created.', containerSchema),
      400: errorRes('The runtime refused the specification.'),
    },
  },
  get: {
    tags: ['Containers'],
    summary: 'Inspect a container',
    security: agentAuth,
    responses: {
      200: jsonRes('Container.', containerSchema),
      404: errorRes('Container not found.'),
    },
  },
  start: {
    tags: ['Containers'],
    summary: 'Start a container',
    security: agentAuth,
    responses: { 200: messageRes('Container started.'), 400: errorRes('Operation failed.') },
  },
  stop: {
    tags: ['Containers'],
    summary: 'Stop a container',
    security: agentAuth,
    responses: {
      200: messageRes('Container stopped.'),
      400: errorRes('Operation failed.'),
      423: protectedRes,
    },
  },
  restart: {
    tags: ['Containers'],
    summary: 'Restart a container',
    security: agentAuth,
    responses: {
      200: messageRes('Container restarted.'),
      400: errorRes('Operation failed.'),
      423: protectedRes,
    },
  },
  reachability: {
    tags: ['Containers'],
    summary: 'Probe a published port from the host',
    description:
      'Opens a TCP connection (or sends a UDP datagram) to 127.0.0.1:<port> from the agent host. ' +
      'Always targets loopback — never an arbitrary host — and carries no application payload.',
    security: agentAuth,
    responses: {
      200: jsonRes('Probe result.', {
        type: 'object',
        properties: {
          reachable: { type: 'boolean' },
          latencyMs: { type: 'number' },
          error: { type: 'string' },
        },
      }),
      404: errorRes('Container not found.'),
    },
  },
  remove: {
    tags: ['Containers'],
    summary: 'Remove a container',
    security: agentAuth,
    responses: {
      200: messageRes('Container removed.'),
      400: errorRes('Operation failed.'),
      423: protectedRes,
    },
  },
  logs: {
    tags: ['Containers'],
    summary: 'Container logs',
    description:
      'Returns a snapshot as JSON, or a live `text/event-stream` when `follow=true`: `log` events ' +
      'carry the lines and a `ping` event every few seconds keeps a quiet container from having ' +
      'its connection closed for being idle. The stream stops when the client disconnects.',
    security: agentAuth,
    parameters: [
      { name: 'tail', in: 'query', schema: { type: 'integer' } },
      { name: 'since', in: 'query', schema: { type: 'string' } },
      { name: 'until', in: 'query', schema: { type: 'string' } },
      { name: 'follow', in: 'query', schema: { type: 'boolean' } },
    ],
    responses: {
      200: jsonRes('Log entries.', {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            stream: { type: 'string', enum: ['stdout', 'stderr'] },
            message: { type: 'string' },
          },
        },
      }),
      404: errorRes('Container not found.'),
      423: protectedRes,
    },
  },
  exec: {
    tags: ['Containers'],
    summary: 'Run a command inside a container',
    security: agentAuth,
    responses: {
      200: jsonRes('Command result.', {
        type: 'object',
        properties: {
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
      }),
      404: errorRes('Container not found.'),
      423: protectedRes,
    },
  },
} satisfies Record<string, DocOptions>;
