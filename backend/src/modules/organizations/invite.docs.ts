import type { DocOptions } from 'hono-route-docs';
import {
  bearerAuth,
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';
import { organizationSchema } from './organizations.docs';

const inviteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['admin', 'member'] },
    invitedBy: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const inviteDocs = {
  list: {
    tags: ['Invites'],
    summary: 'List pending invites',
    description: 'Lists the pending invites of an organization (paginated). Admin or owner.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Invites.', paginatedSchema(inviteSchema)),
      403: errorRes('Permission denied.'),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  create: {
    tags: ['Invites'],
    summary: 'Invite someone',
    description:
      'Creates a single-use invite valid for 7 days and sends it by e-mail. Creating a new ' +
      'invite for the same address revokes the previous pending one. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Invite created.', { type: 'object', properties: { invite: inviteSchema } }),
      403: errorRes('Permission denied.'),
      409: errorRes('That user is already a member.'),
    },
  },
  preview: {
    tags: ['Invites'],
    summary: 'Preview an invite',
    description:
      'Returns the organization and role behind an invite token, so the invitee can see what ' +
      'they are joining before accepting. Requires a user session whose e-mail matches the invite.',
    security: bearerAuth,
    parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
    responses: {
      200: jsonRes('Invite details.', {
        type: 'object',
        properties: {
          organization: organizationSchema,
          role: { type: 'string', enum: ['admin', 'member'] },
        },
      }),
      400: errorRes('Invalid, expired or already used invite.'),
      403: errorRes('The invite belongs to a different e-mail.'),
    },
  },
  accept: {
    tags: ['Invites'],
    summary: 'Accept an invite',
    description:
      'Consumes a single-use invite token and creates the membership. The authenticated user ' +
      'e-mail must match the invited address.',
    security: bearerAuth,
    responses: {
      200: jsonRes('Invite accepted.', {
        type: 'object',
        properties: { organization: organizationSchema },
      }),
      400: errorRes('Invalid, expired or already used invite.'),
      403: errorRes('The invite belongs to a different e-mail.'),
      409: errorRes('You are already a member.'),
    },
  },
  revoke: {
    tags: ['Invites'],
    summary: 'Revoke an invite',
    description: 'Revokes a pending invite. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Invite revoked.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Invite not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
