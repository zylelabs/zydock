import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes, paginatedSchema } from '../../utils/openapi';

const templateSourceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    url: { type: 'string' },
    ref: { type: 'string' },
    enabled: { type: 'boolean' },
    lastSyncedAt: { type: 'string', format: 'date-time' },
    lastError: { type: 'string' },
    templateCount: { type: 'integer' },
    collisions: {
      type: 'array',
      description:
        'Templates this source could not add because their id already exists elsewhere — the ' +
        'embedded catalog always wins, and among external sources the first one registered wins.',
      items: {
        type: 'object',
        properties: {
          templateId: { type: 'string' },
          sourceId: { type: 'string' },
          keptBy: {
            type: 'string',
            description: '"embedded" or the id of the source that kept it',
          },
        },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const templateSourceResponse = { type: 'object', properties: { source: templateSourceSchema } };

export const templateSourcesDocs = {
  list: {
    tags: ['Template sources'],
    summary: 'List the registered community catalog sources',
    description: 'Superuser only. Registering a catalog source is an instance-wide decision.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Template sources.', paginatedSchema(templateSourceSchema)),
      403: errorRes('Permission denied.'),
    },
  },
  create: {
    tags: ['Template sources'],
    summary: 'Register a community catalog source',
    description:
      'Superuser only. Only records the source — it starts unsynced (`templateCount: 0`, no ' +
      '`lastSyncedAt`) until `POST /template-sources/:templateSourceId/sync` is called. Templates ' +
      "from this source run on the operator's own servers: the compose denylist limits the blast " +
      'radius, it does not substitute for trusting the source.',
    security: bearerOrApiKeyAuth,
    responses: {
      201: jsonRes('Registered source.', templateSourceResponse),
      400: errorRes('Invalid "url" or "ref".'),
      403: errorRes('Permission denied.'),
    },
  },
  remove: {
    tags: ['Template sources'],
    summary: 'Remove a community catalog source',
    description:
      'Superuser only. Deletes the source and its on-disk cache; every template it contributed ' +
      'disappears from the catalog on the next request.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Confirmation.', {
        type: 'object',
        properties: { message: { type: 'string' } },
      }),
      403: errorRes('Permission denied.'),
      404: errorRes('Template source not found.'),
    },
  },
  sync: {
    tags: ['Template sources'],
    summary: 'Shallow-clone the source and validate its catalog',
    description:
      'Superuser only. Clones `ref` into a temporary directory, validates every template with the ' +
      'same checks as the embedded catalog (`parseTemplateManifest` + `validateComposeSecurity`), ' +
      'and only then swaps it in atomically. A single invalid template rejects the sync as a whole ' +
      '— it is never half-applied. On failure the previous cache (if any) keeps serving the ' +
      'catalog and the error is recorded in `lastError`; the response is always 200, with the ' +
      'outcome readable from the returned source.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Source after the sync attempt.', templateSourceResponse),
      403: errorRes('Permission denied.'),
      404: errorRes('Template source not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
