import type { DocOptions } from 'hono-route-docs';
import {
  bearerOrApiKeyAuth,
  errorRes,
  jsonRes,
  messageRes,
  paginatedSchema,
} from '../../utils/openapi';

const gitSourceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'active'] },
    appId: { type: 'string', nullable: true },
    slug: { type: 'string', nullable: true },
    htmlUrl: { type: 'string', nullable: true },
    clientId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const gitSourceResponse = { type: 'object', properties: { gitSource: gitSourceSchema } };

const installationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    account: { type: 'string' },
    accountType: { type: 'string' },
    repositorySelection: { type: 'string' },
    htmlUrl: { type: 'string' },
  },
};

const repositorySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    fullName: { type: 'string' },
    private: { type: 'boolean' },
    defaultBranch: { type: 'string' },
  },
};

const manifestResponse = {
  type: 'object',
  properties: {
    gitSource: gitSourceSchema,
    state: { type: 'string' },
    manifest: { type: 'object' },
    postUrl: { type: 'string' },
  },
};

export const gitSourcesDocs = {
  list: {
    tags: ['Git sources'],
    summary: 'List the git sources of an organization',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Git sources.', paginatedSchema(gitSourceSchema)),
      404: errorRes('Organization not found.'),
    },
  },
  manifest: {
    tags: ['Git sources'],
    summary: 'Start a GitHub App manifest registration',
    description:
      'Creates the source as `pending` with a random `state` (15 minutes TTL) and returns the ' +
      'manifest to submit to GitHub as a browser form POST. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Manifest ready to submit.', manifestResponse),
      403: errorRes('Permission denied.'),
    },
  },
  callback: {
    tags: ['Git sources'],
    summary: 'Complete a GitHub App manifest registration',
    description:
      'Validates the `state`, exchanges the `code` for the App credentials, stores them encrypted ' +
      'and marks the source as `active`. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Git source activated.', gitSourceResponse),
      404: errorRes('Unknown, expired or already used state.'),
    },
  },
  get: {
    tags: ['Git sources'],
    summary: 'Read a git source',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Git source.', gitSourceResponse),
      404: errorRes('Git source not found.'),
    },
  },
  listInstallations: {
    tags: ['Git sources'],
    summary: 'List the installations of a git source, live from GitHub',
    description:
      'Nothing is persisted — installing, uninstalling or picking repositories on ' +
      'GitHub reflects here on the next call.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Installations.', {
        type: 'object',
        properties: { items: { type: 'array', items: installationSchema } },
      }),
      400: errorRes('GitHub refused the request.'),
      404: errorRes('Git source not found.'),
    },
  },
  listRepositories: {
    tags: ['Git sources'],
    summary: 'List the repositories of an installation, live from GitHub',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Repositories.', {
        type: 'object',
        properties: { items: { type: 'array', items: repositorySchema } },
      }),
      400: errorRes('GitHub refused the request.'),
      404: errorRes('Git source not found.'),
    },
  },
  remove: {
    tags: ['Git sources'],
    summary: 'Remove a git source',
    description: 'Rejected when an application still points to this source. Admin or owner.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: messageRes('Git source removed successfully.'),
      400: errorRes('The git source is still used by one or more applications.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Git source not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
