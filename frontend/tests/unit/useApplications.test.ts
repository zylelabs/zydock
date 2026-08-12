import { describe, expect, test } from 'bun:test';
import {
  applicationVersionStatus,
  isVersionDowngrade,
  type Application,
  type ApplicationVersionOption,
} from '../../app/composables/services/useApplications';
import type { Template } from '../../app/composables/services/useTemplates';

const application = (overrides: Partial<Application> = {}): Application => ({
  id: 'app-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  environmentId: 'env-1',
  serverId: 'server-1',
  name: 'uptime-kuma',
  slug: 'uptime-kuma',
  status: 'running',
  source: 'compose',
  variables: [],
  restartPolicy: 'unless-stopped',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const template = (overrides: Partial<Template> = {}): Template => ({
  id: 'uptime-kuma',
  version: 1,
  name: 'Uptime Kuma',
  tagline: '',
  category: 'monitoring',
  tags: [],
  author: 'zydock',
  origin: 'official',
  deprecated: false,
  expose: { service: 'uptime-kuma', port: 3001, domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  ...overrides,
});

const options: ApplicationVersionOption[] = [
  { value: '2', label: '2.x (stable)' },
  { value: '1', label: '1.x' },
];

describe('isVersionDowngrade', () => {
  test('moving to a later entry in the list is a downgrade', () => {
    expect(isVersionDowngrade(options, '2', '1')).toBeTrue();
  });

  test('moving to an earlier entry in the list is not a downgrade', () => {
    expect(isVersionDowngrade(options, '1', '2')).toBeFalse();
  });

  test('staying on the same version is not a downgrade', () => {
    expect(isVersionDowngrade(options, '2', '2')).toBeFalse();
  });

  test('an unknown version is never flagged', () => {
    expect(isVersionDowngrade(options, '2', '9')).toBeFalse();
    expect(isVersionDowngrade(options, '9', '1')).toBeFalse();
  });
});

describe('applicationVersionStatus', () => {
  test('application without a template origin is not editable', () => {
    const status = applicationVersionStatus(application(), template());
    expect(status.editable).toBeFalse();
  });

  test('template no longer in the catalog is not editable', () => {
    const status = applicationVersionStatus(
      application({ origin: { templateId: 'uptime-kuma', templateVersion: 1, inputs: {} } }),
      null,
    );
    expect(status.editable).toBeFalse();
  });

  test('template without declared versions is not editable', () => {
    const status = applicationVersionStatus(
      application({ origin: { templateId: 'uptime-kuma', templateVersion: 1, inputs: {} } }),
      template(),
    );
    expect(status.editable).toBeFalse();
  });

  test('template with versions but no resolved current value is not editable', () => {
    const status = applicationVersionStatus(
      application({ origin: { templateId: 'uptime-kuma', templateVersion: 1, inputs: {} } }),
      template({ versions: { key: 'APP_VERSION', default: '2', available: options } }),
    );
    expect(status.editable).toBeFalse();
  });

  test('template with versions and a resolved current value is editable', () => {
    const status = applicationVersionStatus(
      application({
        origin: { templateId: 'uptime-kuma', templateVersion: 1, inputs: {} },
        version: { key: 'APP_VERSION', current: '2' },
      }),
      template({ versions: { key: 'APP_VERSION', default: '2', available: options } }),
    );

    expect(status.editable).toBeTrue();
    if (status.editable) {
      expect(status.current).toBe('2');
      expect(status.key).toBe('APP_VERSION');
      expect(status.options).toEqual(options);
    }
  });
});
