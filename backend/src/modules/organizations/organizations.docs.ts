import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

export const brandingSchema = {
  type: 'object',
  properties: {
    logo: { type: 'string', nullable: true },
    favicon: { type: 'string', nullable: true },
    primaryColor: { type: 'string', nullable: true },
    secondaryColor: { type: 'string', nullable: true },
  },
};

export const organizationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    role: { type: 'string', enum: ['owner', 'admin', 'member'], nullable: true },
    branding: brandingSchema,
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const organizationWrapped = {
  type: 'object',
  properties: { organization: organizationSchema },
};

export const organizationsDocs = {
  list: {
    tags: ['Organizations'],
    summary: 'List own organizations',
    description: 'Lists the organizations the authenticated user belongs to, with their role.',
    security: bearerOrApiKeyAuth,
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ],
    responses: {
      200: jsonRes('Organizations.', paginatedSchema(organizationSchema)),
      401: errorRes('Credentials not provided or invalid.'),
    },
  },
  create: {
    tags: ['Organizations'],
    summary: 'Create an organization',
    description:
      'Creates an organization. The slug is derived from the name, and the creator becomes owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Organization created.', organizationWrapped),
      400: errorRes('Invalid data.'),
    },
  },
  get: {
    tags: ['Organizations'],
    summary: 'Get an organization',
    description: 'Returns an organization the authenticated user belongs to.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Organization.', organizationWrapped),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  update: {
    tags: ['Organizations'],
    summary: 'Update an organization',
    description: 'Updates the name and/or the branding (logo, favicon, colors). Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated organization.', organizationWrapped),
      403: errorRes('Permission denied.'),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
  remove: {
    tags: ['Organizations'],
    summary: 'Delete an organization',
    description: 'Deletes the organization along with its memberships and invites. Owner only.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Organization deleted.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Organization not found or not accessible.'),
    },
  },
} satisfies Record<string, DocOptions>;
