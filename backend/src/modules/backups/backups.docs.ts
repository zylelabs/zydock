import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';
import { BACKUP_STATUSES, BACKUP_TYPES } from './backup.schema';

const backupSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    type: { type: 'string', enum: [...BACKUP_TYPES] },
    status: { type: 'string', enum: [...BACKUP_STATUSES] },
    label: { type: 'string' },
    serverId: { type: 'string', nullable: true },
    databaseId: { type: 'string', nullable: true },
    applicationId: { type: 'string', nullable: true },
    volumeName: { type: 'string', nullable: true },
    engine: { type: 'string', nullable: true },
    fileName: { type: 'string' },
    sizeBytes: { type: 'integer', nullable: true },
    error: { type: 'string', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    durationMs: { type: 'integer', nullable: true },
    restoreStatus: { type: 'string', enum: [...BACKUP_STATUSES], nullable: true },
    restoreError: { type: 'string', nullable: true },
    lastRestoredAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const backupBody = { type: 'object', properties: { backup: backupSchema } };

export const backupsDocs = {
  list: {
    tags: ['Backups'],
    summary: 'List the backups of an organization',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'type', in: 'query' as const, schema: { type: 'string', enum: [...BACKUP_TYPES] } },
      {
        name: 'status',
        in: 'query' as const,
        schema: { type: 'string', enum: [...BACKUP_STATUSES] },
      },
      { name: 'databaseId', in: 'query' as const, schema: { type: 'string' } },
      { name: 'serverId', in: 'query' as const, schema: { type: 'string' } },
    ],
    responses: {
      200: jsonRes('Backups.', paginatedSchema(backupSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Backups'],
    summary: 'Start a backup',
    description:
      'Three kinds. `database` dumps the engine from inside its container (`pg_dump`, `mysqldump`, ' +
      '`mongodump`, Redis snapshot). `volume` archives a Docker volume of a server as a gzipped ' +
      'tar. `configuration` exports what the organization has configured as JSON — **without any ' +
      'secret**, so it documents the platform instead of replaying it. The archive is produced by ' +
      'the queue: the answer is the record, and its `status` says when it is done.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('Backup started.', backupBody),
      400: errorRes('Invalid body, or the target is not in this organization.'),
      409: errorRes('The server of the target has no agent yet.'),
    },
  },
  get: {
    tags: ['Backups'],
    summary: 'Read a backup',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Backup.', backupBody),
      404: errorRes('Backup not found.'),
    },
  },
  download: {
    tags: ['Backups'],
    summary: 'Download the archive of a backup',
    description: 'Streams the object from storage; nothing is loaded into memory on the way.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: {
        description: 'The archive.',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      404: errorRes('Backup not found, or its archive is no longer in storage.'),
      409: errorRes('This backup has not completed.'),
    },
  },
  restore: {
    tags: ['Backups'],
    summary: 'Restore a backup over its target',
    description:
      'Runs in the queue, like the backup itself, and reports on the same record: `restoreStatus` ' +
      'says when it is done and `restoreError` why it is not. A database restore replaces the data ' +
      'of the engine; a volume restore extracts over what is already in the volume. A ' +
      'configuration export cannot be restored — it carries no secret, and recreating resources ' +
      'from it is not automated.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('Restore started.', backupBody),
      400: errorRes('This kind of backup cannot be restored.'),
      404: errorRes('Backup not found.'),
      409: errorRes('This backup has not completed, or a restore is already running.'),
    },
  },
  remove: {
    tags: ['Backups'],
    summary: 'Remove a backup',
    description: 'Deletes the archive from storage and the record.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Backup removed.'),
      404: errorRes('Backup not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
