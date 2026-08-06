import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes, messageRes } from '../../utils/openapi';

export const repositoriesDocs = {
  clone: {
    tags: ['Repositories'],
    summary: 'Clone a repository into a build workspace',
    description:
      'The workspace is disposable and recreated on every call. Always answers with a ' +
      '`text/event-stream`: `log` events carry the git output, and the stream ends with a ' +
      'single `result` event (the commit that was checked out, which is what names the built ' +
      'image) or an `error` event (the failure).',
    security: agentAuth,
    responses: {
      200: {
        description: 'Clone output followed by the result.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
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
