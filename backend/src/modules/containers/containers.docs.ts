import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

export const containerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    image: { type: 'string' },
    state: { type: 'string' },
    health: { type: 'string' },
    startedAt: { type: 'string', nullable: true },
    finishedAt: { type: 'string', nullable: true },
    exitCode: { type: 'integer', nullable: true },
    restartCount: { type: 'integer' },
    ports: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          containerPort: { type: 'integer' },
          hostPort: { type: 'integer', nullable: true },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
        },
      },
    },
    labels: { type: 'object', additionalProperties: { type: 'string' } },
  },
};

/** Every route of this layer reaches the runtime through the agent of the server. */
const unreachable = errorRes('The agent of this server could not be reached.');

const notProvisioned = errorRes('This server has no agent yet.');

export const containersDocs = {
  list: {
    tags: ['Containers'],
    summary: 'List the containers of a server',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'state', in: 'query', schema: { type: 'string' } },
      { name: 'namePrefix', in: 'query', schema: { type: 'string' } },
      {
        name: 'applicationId',
        in: 'query',
        description: 'Only the containers deployed for this application.',
        schema: { type: 'string' },
      },
      {
        name: 'label',
        in: 'query',
        description: 'One `key=value` pair; repeat the parameter to filter by several labels.',
        schema: { type: 'array', items: { type: 'string' } },
      },
    ],
    responses: {
      200: jsonRes('Containers.', { type: 'array', items: containerSchema }),
      404: errorRes('Server not found.'),
      409: notProvisioned,
      502: unreachable,
    },
  },
  create: {
    tags: ['Containers'],
    summary: 'Create a container on a server',
    description:
      'Creates the container without starting it. Containers of an application are created by the ' +
      'deploy pipeline — this endpoint exists for everything the platform does not deploy itself.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Container created.', containerSchema),
      400: errorRes('The runtime refused the specification.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
  get: {
    tags: ['Containers'],
    summary: 'Inspect a container',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Container.', containerSchema),
      404: errorRes('Container not found.'),
      502: unreachable,
    },
  },
  start: {
    tags: ['Containers'],
    summary: 'Start a container',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Container started.'),
      404: errorRes('Container not found.'),
      502: unreachable,
    },
  },
  stop: {
    tags: ['Containers'],
    summary: 'Stop a container',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'timeout', in: 'query', schema: { type: 'integer' } }],
    responses: {
      200: messageRes('Container stopped.'),
      404: errorRes('Container not found.'),
      502: unreachable,
    },
  },
  restart: {
    tags: ['Containers'],
    summary: 'Restart a container',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Container restarted.'),
      404: errorRes('Container not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Containers'],
    summary: 'Remove a container',
    description:
      'Removing the container of an application leaves it stopped until the next deploy: the ' +
      'platform does not recreate it by itself.',
    security: bearerOrApiKeyAuth,
    parameters: [{ name: 'volumes', in: 'query', schema: { type: 'boolean' } }],
    responses: {
      200: messageRes('Container removed.'),
      404: errorRes('Container not found.'),
      502: unreachable,
    },
  },
  logs: {
    tags: ['Containers'],
    summary: 'Container logs',
    description:
      'Returns a snapshot as JSON, or a live `text/event-stream` when `follow=true`: `log` events ' +
      'carry the lines and a `ping` event every few seconds keeps a quiet container from having ' +
      'its connection closed for being idle. The stream stops when the client disconnects.',
    security: bearerOrApiKeyAuth,
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
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
