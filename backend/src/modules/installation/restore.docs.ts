import type { DocOptions } from 'hono-route-docs';
import { RESTORE_RUN_STATUSES } from '../../providers/restore/restore.contract';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';

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
    log: { type: 'string' },
  },
};

export const restoreDocs = {
  run: {
    tags: ['Installation'],
    summary: 'Restore this installation from a snapshot bundle already on this host',
    description:
      'Superuser only. `bundlePath` must already exist on the local server — the encrypted ' +
      'snapshot is never uploaded through this endpoint. Dispatches the restore to an ephemeral ' +
      'container outside the Compose project and answers 202 with the run id — it never waits for ' +
      'the end, because the stack that would answer is torn down and rebuilt by the restore itself. ' +
      'Follow it on `GET /installation/restore`, tolerating the API going away in the middle: that ' +
      'is the normal path, not a failure.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('The dispatched run.', runSchema),
      400: errorRes('The installation cannot restore itself from here.'),
      403: errorRes('Permission denied.'),
      502: errorRes('The agent of the local server could not be reached.'),
    },
  },
  getRun: {
    tags: ['Installation'],
    summary: 'Read the last restore run',
    description:
      'Superuser only. Reads the state file the restorer container writes in the install ' +
      'directory, with the tail of its log. A run still marked as running whose container is gone ' +
      'answers "unknown" — success is never presumed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The last restore run.', runSchema),
      403: errorRes('Permission denied.'),
      404: errorRes('No restore has run on this installation yet.'),
      502: errorRes('The agent of the local server could not be reached.'),
    },
  },
} satisfies Record<string, DocOptions>;
