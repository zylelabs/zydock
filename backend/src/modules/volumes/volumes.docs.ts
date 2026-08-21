import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const volumeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    driver: { type: 'string' },
    mountpoint: { type: 'string' },
    labels: { type: 'object', additionalProperties: { type: 'string' } },
    protected: { type: 'boolean' },
  },
};

const unreachable = errorRes('The agent of this server could not be reached.');

const protectedRes = errorRes('The volume is part of the Zydock platform and cannot be removed.');

const unmanagedRes = errorRes('The volume was not created by Zydock.');

const fileEntrySchema = {
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

const fileContentRes = {
  description: 'The file content, streamed as it is read.',
  content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
};

export const volumesDocs = {
  list: {
    tags: ['Volumes'],
    summary: 'List the volumes of a server',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Volumes.', { type: 'array', items: volumeSchema }),
      404: errorRes('Server not found.'),
      409: errorRes('This server has no agent yet.'),
      502: unreachable,
    },
  },
  create: {
    tags: ['Volumes'],
    summary: 'Create a volume on a server',
    description:
      'Idempotent: an existing volume with the same name is returned as is. An application mounts ' +
      'a volume by name, so the volume has to exist before the deploy.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Volume created.', volumeSchema),
      400: errorRes('The runtime refused the name.'),
      404: errorRes('Server not found.'),
      502: unreachable,
    },
  },
  remove: {
    tags: ['Volumes'],
    summary: 'Remove a volume from a server',
    description: 'The data in the volume is lost — the runtime does not keep a copy.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Volume removed.'),
      400: errorRes('The volume is still in use by a container.'),
      404: errorRes('Server not found.'),
      423: protectedRes,
      502: unreachable,
    },
  },
  listFiles: {
    tags: ['Volumes'],
    summary: 'List the entries of a directory inside a volume',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Directory entries.', { type: 'array', items: fileEntrySchema }),
      400: errorRes('Invalid path.'),
      404: errorRes('Server, volume or path not found.'),
      423: unmanagedRes,
      502: unreachable,
    },
  },
  readFile: {
    tags: ['Volumes'],
    summary: 'Read a file inside a volume',
    security: bearerOrApiKeyAuth,
    responses: {
      200: fileContentRes,
      400: errorRes('Invalid path.'),
      404: errorRes('Server, volume or file not found.'),
      423: unmanagedRes,
      502: unreachable,
    },
  },
  writeFile: {
    tags: ['Volumes'],
    summary: 'Write a file inside a volume',
    description:
      'Streams the request body straight to the agent through a throwaway container — the ' +
      'backend never buffers the upload in memory.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('File written.'),
      400: errorRes('Invalid path or upload too large.'),
      404: errorRes('Server or volume not found.'),
      423: unmanagedRes,
      502: unreachable,
    },
  },
  createDirectory: {
    tags: ['Volumes'],
    summary: 'Create a directory inside a volume',
    security: bearerOrApiKeyAuth,
    responses: {
      201: messageRes('Directory created.'),
      400: errorRes('Invalid path.'),
      404: errorRes('Server or volume not found.'),
      423: unmanagedRes,
      502: unreachable,
    },
  },
  removeFile: {
    tags: ['Volumes'],
    summary: 'Remove a file or directory inside a volume',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Path removed.'),
      400: errorRes('Invalid path.'),
      404: errorRes('Server, volume or path not found.'),
      423: unmanagedRes,
      502: unreachable,
    },
  },
} satisfies Record<string, DocOptions>;
