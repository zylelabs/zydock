import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';
import { DASHBOARD_STATUSES } from './dashboard.schema';

const settingsSchema = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    status: { type: 'string', enum: [...DASHBOARD_STATUSES] },
    lastError: { type: 'string', nullable: true },
    certificateIssuer: { type: 'string', nullable: true },
    certificateExpiresAt: { type: 'string', format: 'date-time', nullable: true },
    appliedAt: { type: 'string', format: 'date-time', nullable: true },
    publicIp: { type: 'string' },
    ipUrl: { type: 'string' },
    requestHost: { type: 'string' },
    dnsMismatch: { type: 'boolean' },
  },
};

export const dashboardDocs = {
  getSettings: {
    tags: ['Dashboard'],
    summary: 'Read the dashboard domain settings',
    description:
      'Superuser only. Includes the public IP of the local server, the IP URL the panel stays ' +
      'reachable on, and the host the request arrived on, so the UI can show DNS guidance.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Dashboard settings.', settingsSchema),
      403: errorRes('Permission denied.'),
    },
  },
  updateSettings: {
    tags: ['Dashboard'],
    summary: 'Set (or clear) the dashboard domain',
    description:
      'Superuser only. Persists the domain and tries to apply it on the proxy right away. A DNS ' +
      "that hasn't propagated yet does not block saving — the domain is stored as `pending` and " +
      'the certificate is picked up later, on `POST /domain/check`. The IP route is never removed.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated settings.', settingsSchema),
      403: errorRes('Permission denied.'),
      409: errorRes('The hostname is already in use by an application domain.'),
    },
  },
  removeDomain: {
    tags: ['Dashboard'],
    summary: 'Remove the dashboard domain',
    description: 'Superuser only. The dashboard goes back to answering only on the IP.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated settings.', settingsSchema),
      403: errorRes('Permission denied.'),
    },
  },
  check: {
    tags: ['Dashboard'],
    summary: 'Re-check the DNS and the certificate of the configured domain',
    description:
      'Superuser only. Promotes the domain from `pending` to `active` once the proxy has issued a ' +
      'valid certificate for it.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated settings.', settingsSchema),
      403: errorRes('Permission denied.'),
      502: errorRes('The agent of the local server could not be reached.'),
    },
  },
} satisfies Record<string, DocOptions>;
