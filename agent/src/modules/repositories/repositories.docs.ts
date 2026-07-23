import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, jsonRes, messageRes } from '../../utils/openapi';

const cloneSchema = {
  type: 'object',
  properties: {
    workspace: { type: 'string' },
    path: { type: 'string' },
    commit: { type: 'string' },
    message: { type: 'string' },
    author: { type: 'string' },
    committedAt: { type: 'string' },
  },
};

export const repositoriesDocs = {
  clone: {
    tags: ['Repositories'],
    summary: 'Clone a repository into a build workspace',
    description:
      'The workspace is disposable and recreated on every call. Returns the commit that was ' +
      'checked out, which is what names the built image.',
    security: agentAuth,
    responses: {
      200: jsonRes('Repository cloned.', cloneSchema),
      400: errorRes('The clone failed.'),
    },
  },
  remove: {
    tags: ['Repositories'],
    summary: 'Remove a build workspace',
    security: agentAuth,
    responses: {
      200: messageRes('Workspace removed.'),
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
