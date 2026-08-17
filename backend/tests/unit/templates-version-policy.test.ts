import { afterEach, describe, expect, test } from 'bun:test';
import { withImplicitVersions } from '../../src/modules/templates/catalog.service';
import {
  isVersionAllowed,
  resolveDefaultVersion,
} from '../../src/modules/templates/template.service';

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

  test('the default "include" accepts any digit-bearing tag, not just bare semver', () => {
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
    expect(isVersionAllowed(template, '1.23.3-alpine')).toBe(true);
    expect(isVersionAllowed(template, 'postgresql-v2.19.0')).toBe(true);
    expect(isVersionAllowed(template, '2.0.0-beta.1')).toBe(true);
    expect(isVersionAllowed(template, 'pg17-v2.19.0')).toBe(true);
    expect(isVersionAllowed(template, 'alpine')).toBe(false);
  });

  test('the default "exclude" drops moving tags, digests and date stamps', () => {
    const template: Template = {
      ...baseTemplate,
      versions: {
        key: 'APP_VERSION',
        default: '1',
        available: [{ value: '1' }],
        registry: { limit: 50 },
      },
    };

    expect(isVersionAllowed(template, 'nightly')).toBe(false);
    expect(isVersionAllowed(template, '2.4.0-nightly')).toBe(false);
    expect(isVersionAllowed(template, 'edge-1')).toBe(false);
    expect(isVersionAllowed(template, 'main-2f8a1c9')).toBe(false);
    expect(isVersionAllowed(template, 'sha256-9f8e7d6c')).toBe(false);
    expect(isVersionAllowed(template, '3a9f0c1e2b7d')).toBe(false);
    expect(isVersionAllowed(template, '2026-08-16')).toBe(false);
    expect(isVersionAllowed(template, 'pr-1420')).toBe(false);
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

const composeWith = (image: string) => `services:\n  app:\n    image: ${image}\n`;

const manifestWith = (image: string, overrides: Partial<TemplateManifest> = {}) => ({
  ...baseTemplate,
  versions: undefined,
  dockerComposeContent: composeWith(image),
  ...overrides,
});

describe('withImplicitVersions', () => {
  test('fills in registry-backed defaults when an image references ${VERSION}', () => {
    const manifest = manifestWith('nginx:${VERSION}');

    expect(withImplicitVersions(manifest, manifest.dockerComposeContent).versions).toEqual({
      key: 'VERSION',
      available: [],
      registry: { limit: 50 },
    });
  });

  test('keeps a manifest that already declares "versions"', () => {
    const versions = { key: 'APP_VERSION', default: '1', available: [{ value: '1' }] };
    const manifest = manifestWith('nginx:${APP_VERSION}', { versions });

    expect(withImplicitVersions(manifest, manifest.dockerComposeContent).versions).toBe(versions);
  });

  test('leaves an image pinned by digest alone', () => {
    const manifest = manifestWith('nginx@sha256:abc');

    expect(withImplicitVersions(manifest, manifest.dockerComposeContent).versions).toBeUndefined();
  });

  test('does not fill in when ${VERSION} appears outside an image', () => {
    const manifest = manifestWith('nginx:1.27');
    const compose = `${manifest.dockerComposeContent}    environment:\n      TAG: \${VERSION}\n`;

    expect(withImplicitVersions(manifest, compose).versions).toBeUndefined();
  });

  test('does not fill in when VERSION is already an input', () => {
    const manifest = manifestWith('nginx:${VERSION}', {
      inputs: [{ key: 'VERSION', label: 'Version', type: 'text', required: true }],
    });

    expect(withImplicitVersions(manifest, manifest.dockerComposeContent).versions).toBeUndefined();
  });
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockDockerHubTags = (names: string[]) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: names.map(name => ({ name })), next: null }), {
      status: 200,
    })) as unknown as typeof fetch;
};

describe('resolveDefaultVersion', () => {
  const registryTemplate = (repository: string): Template => ({
    ...baseTemplate,
    dockerComposeContent: composeWith(`${repository}:\${VERSION}`),
    versions: { key: 'VERSION', available: [], registry: { limit: 50 } },
  });

  test('returns the declared default without touching the registry', async () => {
    globalThis.fetch = (() => {
      throw new Error('the registry must not be queried');
    }) as unknown as typeof fetch;

    const template: Template = {
      ...baseTemplate,
      versions: { key: 'VERSION', default: '2', available: [{ value: '2' }] },
    };

    expect(await resolveDefaultVersion(template)).toBe('2');
  });

  test('picks the newest plain version tag over a numbered build tag', async () => {
    mockDockerHubTags(['base-debian-node16', 'builder-go3', '2.5.0', '2.4.0']);

    expect(await resolveDefaultVersion(registryTemplate('acme/plain-wins'))).toBe('2.5.0');
  });

  test('falls back to the newest listed tag when no plain version exists', async () => {
    mockDockerHubTags(['2.5.0-slim', '2.4.0-slim']);

    expect(await resolveDefaultVersion(registryTemplate('acme/flavoured-only'))).toBe('2.5.0-slim');
  });

  test('throws when the policy leaves no tag standing', async () => {
    mockDockerHubTags(['latest', 'nightly']);

    expect(resolveDefaultVersion(registryTemplate('acme/nothing-usable'))).rejects.toThrow(
      /No version could be resolved from the registry/,
    );
  });
});
