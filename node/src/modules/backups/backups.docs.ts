import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const archiveRes = {
  description: 'The archive, streamed as it is produced.',
  content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
};

const uploadSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, sizeBytes: { type: 'integer' } },
};

export const backupsDocs = {
  upload: {
    tags: ['Backups'],
    summary: 'Stage an archive on this host',
    description:
      'Receives the raw bytes of an archive and keeps them until a restore consumes them. A restore ' +
      'needs the bytes and the command that reads them; staging first keeps the command in a JSON ' +
      'body.',
    security: agentAuth,
    responses: {
      201: jsonRes('Archive staged.', uploadSchema),
      400: errorRes('Operation failed.'),
    },
  },
  discardUpload: {
    tags: ['Backups'],
    summary: 'Discard a staged archive',
    security: agentAuth,
    responses: {
      200: messageRes('Upload discarded.'),
      400: errorRes('Operation failed.'),
    },
  },
  archiveVolume: {
    tags: ['Backups'],
    summary: 'Archive a volume as a gzipped tar',
    description:
      'Runs a throwaway container with the volume mounted read-only and streams the tar out. The ' +
      'volume is read while it is in use, so a database should be archived by its own dump instead.',
    security: agentAuth,
    responses: {
      200: archiveRes,
      404: errorRes('Volume not found.'),
    },
  },
  restoreVolume: {
    tags: ['Backups'],
    summary: 'Extract a staged archive into a volume',
    description: 'Extracts over what is already there; files the archive does not carry survive.',
    security: agentAuth,
    responses: {
      200: messageRes('Volume restored.'),
      400: errorRes('Operation failed.'),
      404: errorRes('Volume or upload not found.'),
    },
  },
  archiveContainer: {
    tags: ['Backups'],
    summary: 'Run a command inside a container and stream its output',
    description:
      'How a database dump leaves the server: the caller sends the engine command, the agent runs ' +
      'it with `docker exec` and streams standard output.',
    security: agentAuth,
    responses: {
      200: archiveRes,
      400: errorRes('Operation failed.'),
    },
  },
  restoreContainer: {
    tags: ['Backups'],
    summary: 'Feed a staged archive into a command inside a container',
    security: agentAuth,
    responses: {
      200: messageRes('Archive restored.'),
      400: errorRes('Operation failed.'),
      404: errorRes('Upload not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
