import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';
import { INSTALLATION_ROLES } from './installation.schema';

const installationSchema = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [...INSTALLATION_ROLES] },
    standbySince: { type: 'string', format: 'date-time' },
    promotedAt: { type: 'string', format: 'date-time' },
    demotedAt: { type: 'string', format: 'date-time' },
    dataFrom: { type: 'string', format: 'date-time' },
    replicaOf: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        publicIp: { type: 'string' },
        version: { type: 'string' },
        snapshotAt: { type: 'string', format: 'date-time' },
      },
    },
    lastSnapshotAt: { type: 'string', format: 'date-time' },
    note: { type: 'string' },
  },
};

export const installationDocs = {
  get: {
    tags: ['Installation'],
    summary: 'Read the state of this installation',
    description:
      'Superuser only. The role stored in the database is the authority over the environment: ' +
      'it is what makes a demotion survive a reboot. `dataFrom` and `replicaOf` are filled when ' +
      'this installation was restored from a snapshot of another one.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The installation state.', installationSchema),
      403: errorRes('Permission denied.'),
    },
  },
  demote: {
    tags: ['Installation'],
    summary: 'Put this installation in standby',
    description:
      'Superuser only. Marks the installation as standby, so it stops working and stops being ' +
      'the authority over the servers it manages. Nothing is removed: the installation stays on ' +
      'disk as a rollback. Idempotent.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The installation state after the demotion.', installationSchema),
      403: errorRes('Permission denied.'),
    },
  },
  promote: {
    tags: ['Installation'],
    summary: 'Make this installation the active one',
    description:
      'Superuser only. Two active installations reserve the same jobs, write the same proxy ' +
      'routes and fight over the same containers — promote only when the origin is already in ' +
      'standby (checked over its `/api/health`). Reachable and still active: blocked. ' +
      'Unreachable: pass `force: true` to proceed anyway. On success this also forces the local ' +
      'server public IP to the current host, reconciles missing database containers and enqueues ' +
      'the reprovisioning of the managed SSH servers. Idempotent.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The installation state after the promotion.', installationSchema),
      403: errorRes('Permission denied.'),
      409: errorRes('The origin installation is still active and reachable, or force was not set.'),
    },
  },
  dnsChecklist: {
    tags: ['Installation'],
    summary: 'Check which domains still point to the old IP',
    description:
      'Superuser only. Resolves the panel domain and every application domain on the local ' +
      'server, flagging the ones that do not resolve to this host public IP yet.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The DNS checklist.', {
        type: 'object',
        properties: {
          domains: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['dashboard', 'application'] },
                domain: { type: 'string' },
                pointsToOldIp: { type: 'boolean' },
              },
            },
          },
        },
      }),
      403: errorRes('Permission denied.'),
    },
  },
} satisfies Record<string, DocOptions>;
