import type { DocOptions } from 'hono-route-docs';
import { errorRes, messageRes } from '../../utils/openapi';

export const accessAggregateDocs = {
  ingest: {
    tags: ['Proxy'],
    summary: 'Ingest a batch of proxy access-log aggregates',
    description:
      'Called by the agent on its own interval, authenticated with its own token via the ' +
      '`X-Agent-Token` header. Each bucket is a per (host, minute) counter — never a raw request ' +
      '— and is merged with `$inc` so retried batches stay safe to resend.',
    responses: {
      200: messageRes('Access aggregates accepted.'),
      401: errorRes('Invalid agent token.'),
      404: errorRes('Server not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
