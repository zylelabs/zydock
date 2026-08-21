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
    commit: { type: 'string', description: 'Commit currently active in the composed catalog.' },
    pendingCommit: {
      type: 'string',
      description: 'Commit fetched by the last sync, differs from `commit` and awaits acceptance.',
    },
    pendingTemplateCount: { type: 'integer' },
    pendingSyncedAt: { type: 'string', format: 'date-time' },
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
      'and reads the commit the clone resolved to. The first sync ever, and any sync that resolves ' +
      'to the same commit already active, applies immediately. A sync that resolves to a ' +
      '**different** commit than the one currently active is cached but **not** applied — it is ' +
      'exposed as `pendingCommit`/`pendingTemplateCount` until `POST ' +
      '/:templateSourceId/accept-update` or `.../reject-update` is called, so the source cannot ' +
      'change what an installation runs without an explicit look at what changed. A single invalid ' +
      'template rejects the sync as a whole. On failure the previously active cache (if any) keeps ' +
      'serving the catalog and the error is recorded in `lastError`; the response is always 200, ' +
      'with the outcome readable from the returned source.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Source after the sync attempt.', templateSourceResponse),
      403: errorRes('Permission denied.'),
      404: errorRes('Template source not found.'),
    },
  },
  acceptUpdate: {
    tags: ['Template sources'],
    summary: 'Apply the pending commit fetched by the last sync',
    description:
      'Superuser only. Swaps the cached `pendingCommit` catalog into place and makes it `commit`. ' +
      'Fails with 400 when there is no pending update, or when the cached clone is no longer on ' +
      'disk (sync again in that case).',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Source after accepting the update.', templateSourceResponse),
      400: errorRes('No pending update to accept.'),
      403: errorRes('Permission denied.'),
      404: errorRes('Template source not found.'),
    },
  },
  rejectUpdate: {
    tags: ['Template sources'],
    summary: 'Discard the pending commit fetched by the last sync',
    description:
      'Superuser only. Deletes the cached pending clone and clears `pendingCommit`. The catalog ' +
      'keeps serving the previously accepted `commit` until the next sync.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Source after rejecting the update.', templateSourceResponse),
      403: errorRes('Permission denied.'),
      404: errorRes('Template source not found.'),
    },
  },
} satisfies Record<string, DocOptions>;
