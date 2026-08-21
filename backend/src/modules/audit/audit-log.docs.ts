import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';
import { AUDIT_LOG_ACTIONS } from './audit-log.schema';

const auditLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    userId: { type: 'string' },
    serverId: { type: 'string' },
    action: { type: 'string', enum: [...AUDIT_LOG_ACTIONS] },
    containerId: { type: 'string', nullable: true },
    volume: { type: 'string', nullable: true },
    path: { type: 'string', nullable: true },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const auditLogDocs = {
  list: {
    tags: ['Audit log'],
    summary: 'Privileged operations performed on the servers of an organization',
    description:
      'Records every console session and every read, write or removal of a volume file, with ' +
      'who did it and when. Most recent first. Retention is bounded by a TTL, so old records ' +
      'expire on their own.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'serverId', in: 'query' as const, schema: { type: 'string' } },
      {
        name: 'action',
        in: 'query' as const,
        schema: { type: 'string', enum: [...AUDIT_LOG_ACTIONS] },
      },
    ],
    responses: {
      200: jsonRes('Audit log entries.', paginatedSchema(auditLogSchema)),
      404: errorRes('Organization not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
