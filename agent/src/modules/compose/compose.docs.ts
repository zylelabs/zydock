import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const writeResultSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    path: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
  },
};

const configResultSchema = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    output: { type: 'string' },
    error: { type: 'string', nullable: true },
  },
};

const serviceStatusSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    service: { type: 'string' },
    state: { type: 'string' },
    health: { type: 'string' },
    publishers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          targetPort: { type: 'integer' },
          publishedPort: { type: 'integer', nullable: true },
          protocol: { type: 'string' },
        },
      },
    },
  },
};

export const composeDocs = {
  write: {
    tags: ['Compose'],
    summary: 'Write the files of a Compose project into its workspace',
    description:
      'Overwrites the project workspace with the given files (docker-compose.yml, ' +
      'zydock.override.yml, .env) — no operation runs `docker compose` yet.',
    security: agentAuth,
    responses: {
      201: jsonRes('The files were written.', writeResultSchema),
      400: errorRes('Invalid project or files.'),
    },
  },
  config: {
    tags: ['Compose'],
    summary: 'Validate and normalize a Compose project',
    description: 'Runs `docker compose config` and reports the normalized output or the error.',
    security: agentAuth,
    responses: {
      200: jsonRes('The validation result.', configResultSchema),
      404: errorRes('No such compose project.'),
    },
  },
  pull: {
    tags: ['Compose'],
    summary: 'Pull the images of a Compose project',
    description:
      'Always answers with a `text/event-stream`: `log` events carry the `docker compose pull` ' +
      'output, and the stream ends with a `result` event or an `error` event.',
    security: agentAuth,
    responses: {
      200: {
        description: 'Pull output followed by the result.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
    },
  },
  up: {
    tags: ['Compose'],
    summary: 'Start a Compose project',
    description:
      'Runs `docker compose up --detach --remove-orphans`. Always answers with a ' +
      '`text/event-stream`, same shape as pull.',
    security: agentAuth,
    responses: {
      200: {
        description: 'Up output followed by the result.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
    },
  },
  down: {
    tags: ['Compose'],
    summary: 'Stop a Compose project',
    description:
      'Runs `docker compose down --remove-orphans`, with `?volumes=true` to also drop volumes.',
    security: agentAuth,
    responses: {
      200: messageRes('Compose project stopped.'),
      400: errorRes('Operation failed.'),
    },
  },
  ps: {
    tags: ['Compose'],
    summary: 'List the services of a Compose project',
    security: agentAuth,
    responses: {
      200: jsonRes('The services and their state.', { type: 'array', items: serviceStatusSchema }),
      404: errorRes('No such compose project.'),
    },
  },
  restart: {
    tags: ['Compose'],
    summary: 'Restart a Compose project, or one of its services',
    description: 'With `?service=`, restarts only that service; otherwise restarts every service.',
    security: agentAuth,
    responses: {
      200: messageRes('Compose project restarted.'),
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
