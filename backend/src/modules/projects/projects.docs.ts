import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const projectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const projectResponse = { type: 'object', properties: { project: projectSchema } };

export const projectsDocs = {
  list: {
    tags: ['Projects'],
    summary: 'List the projects of an organization',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Projects.', paginatedSchema(projectSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  create: {
    tags: ['Projects'],
    summary: 'Create a project',
    description: 'The project is created with the default `production` environment.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Project created.', projectResponse),
      403: errorRes('Permission denied.'),
    },
  },
  get: {
    tags: ['Projects'],
    summary: 'Read a project',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Project.', projectResponse),
      404: errorRes('Project not found.'),
    },
  },
  update: {
    tags: ['Projects'],
    summary: 'Update a project',
    description: 'Renaming recalculates the slug, which stays unique inside the organization.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Project updated.', projectResponse),
      404: errorRes('Project not found.'),
    },
  },
  remove: {
    tags: ['Projects'],
    summary: 'Remove a project',
    description: 'Removes the environments and the applications of the project as well.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Project removed successfully.'),
      404: errorRes('Project not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
