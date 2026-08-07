import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes } from '../../utils/openapi';
import { UPDATE_RUN_STATUSES } from './updates.schema';

const runSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: [...UPDATE_RUN_STATUSES] },
    from: { type: 'string' },
    to: { type: 'string' },
    channel: { type: 'string' },
    installPath: { type: 'string' },
    startedAt: { type: 'string' },
    finishedAt: { type: 'string' },
    error: { type: 'string' },
    exitCode: { type: 'integer' },
  },
};

const runWithLogSchema = {
  type: 'object',
  properties: { ...runSchema.properties, log: { type: 'string' } },
};

export const updatesDocs = {
  start: {
    tags: ['Updates'],
    summary: 'Start an update of the Zydock install',
    description:
      'Starts scripts/update.sh in an ephemeral container outside the Compose project, with the ' +
      'Docker socket and the install directory mounted, and returns as soon as it is dispatched. ' +
      'The stack — this agent included — is restarted by the update, so the progress lives in ' +
      '.zydock-update.json and .zydock-update.log inside the install directory.',
    security: agentAuth,
    responses: {
      202: jsonRes('The update was dispatched.', runSchema),
      400: errorRes('The install directory is not visible to the agent.'),
      401: errorRes('Invalid agent token.'),
      409: errorRes('An update is already running.'),
    },
  },
  read: {
    tags: ['Updates'],
    summary: 'Read the state of an update run',
    description:
      'Reads the state file written by the updater container. A run still marked as running whose ' +
      'container is gone becomes "unknown" — success is never presumed.',
    security: agentAuth,
    responses: {
      200: jsonRes('The update run, with the tail of its log.', runWithLogSchema),
      401: errorRes('Invalid agent token.'),
      404: errorRes('No such update run.'),
    },
  },
} satisfies Record<string, DocOptions>;
