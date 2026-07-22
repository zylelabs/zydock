import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const memberSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    role: { type: 'string', enum: ['owner', 'admin', 'member'] },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    avatar: { type: 'string', nullable: true },
    joinedAt: { type: 'string', format: 'date-time' },
  },
};

export const membershipDocs = {
  list: {
    tags: ['Members'],
    summary: 'List organization members',
    description: 'Lists the members of an organization (paginated). Any member can read.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Members.', paginatedSchema(memberSchema)),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  leave: {
    tags: ['Members'],
    summary: 'Leave the organization',
    description:
      'Removes the authenticated user from the organization. The last owner cannot leave.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Left the organization.'),
      400: errorRes('The last owner cannot leave the organization.'),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  update: {
    tags: ['Members'],
    summary: 'Change a member role',
    description:
      'Changes the role of a member. Only an owner can grant or revoke the owner role, and the ' +
      'last owner cannot be demoted.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated member.', { type: 'object', properties: { member: memberSchema } }),
      400: errorRes('The last owner cannot be demoted.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Member not found.'),
    },
  },
  remove: {
    tags: ['Members'],
    summary: 'Remove a member',
    description:
      'Removes a member from the organization. Only an owner can remove another owner, and the ' +
      'last owner cannot be removed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Member removed.'),
      400: errorRes('The last owner cannot be removed.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Member not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
