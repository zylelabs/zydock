import type { DocOptions } from 'hono-route-docs';
import { bearerOrApiKeyAuth, errorRes, jsonRes } from '../../utils/openapi';
import { UPDATE_RUN_STATUSES } from '../../providers/updater/updater.contract';
import { UPDATE_CHANNELS, UPDATE_CHECK_SOURCES, UPDATE_FREQUENCIES } from './update.schema';

const settingsSchema = {
  type: 'object',
  properties: {
    channel: { type: 'string', enum: [...UPDATE_CHANNELS] },
    branch: { type: 'string' },
    auto: { type: 'boolean' },
    frequency: { type: 'string', enum: [...UPDATE_FREQUENCIES] },
  },
};

const statusSchema = {
  type: 'object',
  properties: {
    ...settingsSchema.properties,
    installed: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        commit: { type: 'string' },
        channel: { type: 'string' },
      },
    },
    remote: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        version: { type: 'string' },
        commit: { type: 'string' },
      },
    },
    updateAvailable: { type: 'boolean' },
    nextCheckAt: { type: 'string', format: 'date-time' },
    lastRunId: { type: 'string' },
    lastCheckedAt: { type: 'string', format: 'date-time' },
    lastCheckSource: { type: 'string', enum: [...UPDATE_CHECK_SOURCES] },
    lastCheckError: { type: 'string' },
  },
};

const runSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: [...UPDATE_RUN_STATUSES] },
    from: { type: 'string' },
    to: { type: 'string' },
    channel: { type: 'string' },
    startedAt: { type: 'string' },
    finishedAt: { type: 'string' },
    error: { type: 'string' },
    exitCode: { type: 'integer' },
    log: { type: 'string' },
    rollbackCommand: { type: 'string' },
  },
};

export const updatesDocs = {
  status: {
    tags: ['Updates'],
    summary: 'Read the update status of the installation',
    description:
      'Superuser only. Answers from the stored state, without calling GitHub. `updateAvailable` ' +
      'compares the installed commit with the head of the selected channel — never versions.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Update status.', statusSchema),
      403: errorRes('Permission denied.'),
    },
  },
  getSettings: {
    tags: ['Updates'],
    summary: 'Read the update preferences',
    description: 'Superuser only.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Update preferences.', settingsSchema),
      403: errorRes('Permission denied.'),
    },
  },
  updateSettings: {
    tags: ['Updates'],
    summary: 'Change the update preferences',
    description:
      'Superuser only. Changing the channel or the tracked branch discards the last check, ' +
      'because the stored head belongs to the previous selection.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Updated preferences.', settingsSchema),
      400: errorRes('A branch is required when the channel is "branch".'),
      403: errorRes('Permission denied.'),
    },
  },
  check: {
    tags: ['Updates'],
    summary: 'Check the channel head on GitHub',
    description:
      'Superuser only. Calls the public GitHub API and stores the result. A rate limit or a ' +
      'network failure answers 502 — it never reports the installation as up to date.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('Update status after the check.', statusSchema),
      403: errorRes('Permission denied.'),
      502: errorRes('GitHub could not be reached.'),
    },
  },
  run: {
    tags: ['Updates'],
    summary: 'Update the installation to the head of the selected channel',
    description:
      'Superuser only. Dispatches the update to an ephemeral container outside the Compose ' +
      'project and answers 202 with the run id — it never waits for the end, because the backend ' +
      'that would answer is restarted by the update itself. Follow it on ' +
      '`GET /updates/runs/{runId}`, tolerating the API going away in the middle: that is the ' +
      'normal path, not a failure.',
    security: bearerOrApiKeyAuth,
    responses: {
      202: jsonRes('The dispatched run.', runSchema),
      400: errorRes('The installation cannot update itself from here.'),
      403: errorRes('Permission denied.'),
      502: errorRes('The agent of the local server could not be reached.'),
    },
  },
  getRun: {
    tags: ['Updates'],
    summary: 'Read an update run',
    description:
      'Superuser only. Reads the state file the updater container writes in the install ' +
      'directory, with the tail of its log. A run still marked as running whose container is gone ' +
      'answers "unknown" — success is never presumed. `rollbackCommand` is the command the ' +
      'operator runs to go back; it is never executed by the dashboard.',
    security: bearerOrApiKeyAuth,
    responses: {
      200: jsonRes('The update run.', runSchema),
      403: errorRes('Permission denied.'),
      404: errorRes('No such update run.'),
      502: errorRes('The agent of the local server could not be reached.'),
    },
  },
} satisfies Record<string, DocOptions>;
