import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';
import { SNAPSHOT_STATUSES } from './snapshot.schema';

const snapshotSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: [...SNAPSHOT_STATUSES] },
    includesApplicationData: { type: 'boolean' },
    version: { type: 'string', nullable: true },
    commit: { type: 'string', nullable: true },
    sizeBytes: { type: 'integer', nullable: true },
    error: { type: 'string', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    durationMs: { type: 'integer', nullable: true },
    fileName: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const snapshotBody = { type: 'object', properties: { snapshot: snapshotSchema } };

export const snapshotsDocs = {
  list: {
    tags: ['Installation'],
    summary: 'List the snapshots of this installation',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Snapshots.', {
        type: 'object',
        properties: { snapshots: { type: 'array', items: snapshotSchema } },
      }),
      403: errorRes('Permission denied.'),
    },
  },
  create: {
    tags: ['Installation'],
    summary: 'Snapshot this installation',
    description:
      'Superuser only. Asks the local agent to dump the Mongo database, the backend-storage, ' +
      'caddy-data and caddy-config volumes and, optionally, the volumes of every application and ' +
      'managed database on this server. The bundle is encrypted with the given passphrase (scrypt + ' +
      'AES-256-GCM) before it ever touches storage, so **the file carries every secret this ' +
      'installation has** — `ENCRYPTION_KEY`, `JWT_SECRET`, the Mongo password and the SSH ' +
      'credentials of every managed server. The passphrase is never stored: if it is lost, the ' +
      'snapshot cannot be decrypted. Runs in the background; `status` on the returned record says ' +
      'when it is done.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('Snapshot started.', snapshotBody),
      403: errorRes('Permission denied.'),
    },
  },
  download: {
    tags: ['Installation'],
    summary: 'Download the encrypted archive of a snapshot',
    description: 'Streams the object from storage; nothing is loaded into memory on the way.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: {
        description: 'The encrypted archive.',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      404: errorRes('Snapshot not found, or its archive is no longer in storage.'),
      409: errorRes('This snapshot has not completed.'),
    },
  },
  remove: {
    tags: ['Installation'],
    summary: 'Remove a snapshot',
    description: 'Deletes the archive from storage and the record.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Snapshot removed.'),
      404: errorRes('Snapshot not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
