import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes } from '../../utils/openapi';
import { RESTORE_RUN_STATUSES } from './restore.schema';

const runSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: [...RESTORE_RUN_STATUSES] },
    bundlePath: { type: 'string' },
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

export const restoreDocs = {
  start: {
    tags: ['Installation'],
    summary: 'Restore this installation from a snapshot bundle',
    description:
      'Starts scripts/restore.sh in an ephemeral container outside the Compose project, with the ' +
      'Docker socket and the install directory mounted, and returns as soon as it is dispatched. ' +
      'The stack — this agent included — is torn down and rebuilt by the restore, so the progress ' +
      'lives in .zydock-restore.json and .zydock-restore.log inside the install directory.',
    security: agentAuth,
    responses: {
      202: jsonRes('The restore was dispatched.', runSchema),
      400: errorRes('The install directory is not visible to the agent.'),
      401: errorRes('Invalid agent token.'),
      409: errorRes('A restore is already running.'),
    },
  },
  stageBundle: {
    tags: ['Installation'],
    summary: 'Stage a snapshot bundle onto the install directory',
    description:
      'Streams the request body straight into `.zydock-snapshots/<snapshotId>.zsnap` inside the ' +
      'install directory, so it is visible to the restorer container the same way a bundle placed ' +
      'there by hand would be. Overwrites any bundle already staged under that id.',
    security: agentAuth,
    responses: {
      201: jsonRes('The bundle was staged.', {
        type: 'object',
        properties: { path: { type: 'string' } },
      }),
      400: errorRes('The request has no body to stage.'),
      401: errorRes('Invalid agent token.'),
    },
  },
  read: {
    tags: ['Installation'],
    summary: 'Read the state of a restore run',
    description:
      'Reads the state file written by the restorer container. A run still marked as running whose ' +
      'container is gone becomes "unknown" — success is never presumed.',
    security: agentAuth,
    responses: {
      200: jsonRes('The restore run, with the tail of its log.', runWithLogSchema),
      401: errorRes('Invalid agent token.'),
      404: errorRes('No such restore run.'),
    },
  },
} satisfies Record<string, DocOptions>;
