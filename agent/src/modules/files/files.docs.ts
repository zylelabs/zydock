import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const entrySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    path: { type: 'string' },
    type: { type: 'string', enum: ['file', 'directory'] },
    sizeBytes: { type: 'integer' },
    modifiedAt: { type: 'string', format: 'date-time' },
    readableAsText: { type: 'boolean' },
  },
};

const contentRes = {
  description: 'The file content, streamed as it is read.',
  content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
};

export const filesDocs = {
  list: {
    tags: ['Files'],
    summary: 'List the entries of a directory inside a volume',
    description: 'Runs a throwaway container with the volume mounted read-only to list entries.',
    security: agentAuth,
    responses: {
      200: jsonRes('Directory entries.', { type: 'array', items: entrySchema }),
      400: errorRes('Invalid path.'),
      404: errorRes('Volume or path not found.'),
    },
  },
  readContent: {
    tags: ['Files'],
    summary: 'Read a file inside a volume',
    security: agentAuth,
    responses: {
      200: contentRes,
      400: errorRes('Invalid path.'),
      404: errorRes('Volume or file not found.'),
    },
  },
  writeContent: {
    tags: ['Files'],
    summary: 'Write a file inside a volume',
    description:
      'Receives the raw bytes of the file and writes them through a throwaway container.',
    security: agentAuth,
    responses: {
      200: messageRes('File written.'),
      400: errorRes('Invalid path or upload too large.'),
      404: errorRes('Volume or parent directory not found.'),
    },
  },
  createDirectory: {
    tags: ['Files'],
    summary: 'Create a directory inside a volume',
    security: agentAuth,
    responses: {
      201: messageRes('Directory created.'),
      400: errorRes('Invalid path.'),
      404: errorRes('Volume or parent directory not found.'),
    },
  },
  remove: {
    tags: ['Files'],
    summary: 'Remove a file or directory inside a volume',
    security: agentAuth,
    responses: {
      200: messageRes('Path removed.'),
      400: errorRes('Invalid path.'),
      404: errorRes('Volume or path not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
