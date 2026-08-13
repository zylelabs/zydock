import { describe, expect, test } from 'bun:test';
import { isVersionAllowed } from '../../src/modules/templates/template.service';

const baseTemplate: Template = {
  id: 'unit-version-policy-app',
  version: 1,
  name: 'Unit version policy',
  tagline: 'tagline',
  category: 'test',
  tags: [],
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 80, domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  deprecated: false,
  dockerComposeContent: 'services:\n  app:\n    image: nginx:${APP_VERSION}\n',
};

describe('isVersionAllowed', () => {
  test('without "versions" it always rejects', () => {
    expect(isVersionAllowed(baseTemplate, '1')).toBe(false);
  });

  test('without "versions.registry" it is membership in "available"', () => {
    const template: Template = {
      ...baseTemplate,
      versions: { key: 'APP_VERSION', default: '1', available: [{ value: '1' }, { value: '2' }] },
    };

    expect(isVersionAllowed(template, '1')).toBe(true);
    expect(isVersionAllowed(template, '3')).toBe(false);
  });

  test('rejects "latest" even with a registry policy', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { limit: 50 },
      },
    };

    expect(isVersionAllowed(template, 'latest')).toBe(false);
  });

  test('rejects a value with an invalid tag format', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { limit: 50 },
      },
    };

    expect(isVersionAllowed(template, '../etc/passwd')).toBe(false);
    expect(isVersionAllowed(template, '')).toBe(false);
  });

  test('with a registry policy, matches the default semver "include" pattern', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { limit: 50 },
      },
    };

    expect(isVersionAllowed(template, '2.4.0')).toBe(true);
    expect(isVersionAllowed(template, 'nightly')).toBe(false);
  });

  test('respects a custom "include"', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { include: '^\\d+-alpine$', limit: 50 },
      },
    };

    expect(isVersionAllowed(template, '18-alpine')).toBe(true);
    expect(isVersionAllowed(template, '2.4.0')).toBe(false);
  });

  test('rejects a value that matches "exclude"', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { exclude: '-rc\\d+$', limit: 50 },
      },
    };

    expect(isVersionAllowed(template, '2.4.0-rc1')).toBe(false);
    expect(isVersionAllowed(template, '2.4.0')).toBe(true);
  });

  test('a curated value is always allowed, even outside "include"', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: 'stable',
        available: [{ value: 'stable' }],
        registry: { limit: 50 },
      },
    };

    expect(isVersionAllowed(template, 'stable')).toBe(true);
  });
});
