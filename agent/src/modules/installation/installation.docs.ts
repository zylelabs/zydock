import type { DocOptions } from 'hono-route-docs';
import { agentAuth, errorRes } from '../../utils/openapi';

export const installationDocs = {
  snapshot: {
    tags: ['Installation'],
    summary: 'Assemble and stream a snapshot bundle of this installation',
    description:
      'Dumps the Mongo database, archives the backend-storage, caddy-data and caddy-config volumes, ' +
      'reads the install-dir .env and writes a manifest.json with the size and hash of every part — ' +
      'all in one streamed bundle. The bundle leaves this endpoint unencrypted: it carries every ' +
      'secret this installation has, and the caller is responsible for encrypting it before it ' +
      'touches storage.',
    security: agentAuth,
    responses: {
      200: {
        description: 'The bundle, streamed as it is produced.',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      400: errorRes('Operation failed.'),
    },
  },
} satisfies Record<string, DocOptions>;
