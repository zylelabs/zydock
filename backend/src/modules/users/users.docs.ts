import type { DocOptions } from 'hono-route-docs';
import {
  bearerAuth,
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

export const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    avatar: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'disabled'] },
    superuser: { type: 'boolean' },
    lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const userWrapped = { type: 'object', properties: { user: userSchema } };

export const usersDocs = {
  me: {
    tags: ['Users'],
    summary: 'Authenticated user',
    description: 'Returns the user behind the access token or API key.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Authenticated user data.', userWrapped),
      401: errorRes('Credentials not provided or invalid.'),
      404: errorRes('User not found.'),
    },
  },
  updateMe: {
    tags: ['Users'],
    summary: 'Update own profile',
    description: 'Updates the authenticated user name and/or avatar.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated user data.', userWrapped),
      401: errorRes('Credentials not provided or invalid.'),
      404: errorRes('User not found.'),
    },
  },
  changePassword: {
    tags: ['Users'],
    summary: 'Change own password',
    description:
      'Changes the authenticated user password and revokes every other session. ' +
      'Requires a user session — an API key is not accepted.',
    security: bearerAuth,
    responses: {
      200: messageRes('Password changed.'),
      401: errorRes('Invalid credentials.'),
      403: errorRes('Requires a user session.'),
      404: errorRes('User not found.'),
    },
  },
  list: {
    tags: ['Users'],
    summary: 'List users',
    description: 'Lists users (paginated), with optional search and status filter. Superuser only.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'disabled'] } },
    ],
    responses: {
      200: jsonRes('Users.', paginatedSchema(userSchema)),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Users'],
    summary: 'Get user',
    description: 'Returns a user by id. Superuser only.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('User data.', userWrapped),
      403: errorRes('Permission denied.'),
      404: errorRes('User not found.'),
    },
  },
  update: {
    tags: ['Users'],
    summary: 'Update user',
    description: 'Updates name, avatar and/or status of a user. Superuser only.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated user data.', userWrapped),
      400: errorRes('Cannot manage your own account here.'),
      403: errorRes('Permission denied.'),
      404: errorRes('User not found.'),
    },
  },
  remove: {
    tags: ['Users'],
    summary: 'Disable user',
    description: 'Disables a user and revokes all of their sessions and API keys. Superuser only.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('User disabled.'),
      400: errorRes('Cannot disable your own account.'),
      403: errorRes('Permission denied.'),
      404: errorRes('User not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
