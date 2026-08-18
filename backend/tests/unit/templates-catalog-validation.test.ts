import { describe, expect, test } from 'bun:test';
import { parseComposeDocument } from '../../src/modules/compose/compose.service';
import {
  assertDatabaseCredentialsAreDeclared,
  assertServiceExists,
  assertVariablesAreDeclared,
  assertVersionsAreUsed,
  assertVersionsRegistryHasRepository,
  imagesOf,
  repositoryForVersions,
} from '../../src/modules/templates/catalog.service';

const manifest = (overrides: Partial<TemplateManifest> = {}): TemplateManifest => ({
  id: 'sample',
  version: 1,
  name: 'Sample',
  tagline: 'A sample template',
  category: 'automation',
  tags: [],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  dockerCompose: 'docker-compose.yml',
  expose: { service: 'app', port: 8080, kind: 'http', domain: true },
  databases: [],
  inputs: [],
  secrets: [],
  deprecated: false,
  ...overrides,
});

describe('assertVariablesAreDeclared', () => {
  test('accepts a variable declared as an input', () => {
    expect(() =>
      assertVariablesAreDeclared(
        manifest({
          inputs: [{ key: 'TIMEZONE', label: 'Timezone', type: 'text', required: false }],
        }),
        'services:\n  app:\n    environment:\n      TZ: ${TIMEZONE}\n',
      ),
    ).not.toThrow();
  });

  test('accepts a variable declared as a secret', () => {
    expect(() =>
      assertVariablesAreDeclared(
        manifest({ secrets: [{ key: 'APP_SECRET', generate: 'hex32' }] }),
        'services:\n  app:\n    environment:\n      SECRET: ${APP_SECRET}\n',
      ),
    ).not.toThrow();
  });

  test('accepts a ZYDOCK_-prefixed variable without declaring it', () => {
    expect(() =>
      assertVariablesAreDeclared(
        manifest(),
        'services:\n  app:\n    environment:\n      HOST: ${ZYDOCK_DOMAIN}\n',
      ),
    ).not.toThrow();
  });

  test('rejects a variable that is not declared and has no ZYDOCK_ prefix', () => {
    expect(() =>
      assertVariablesAreDeclared(
        manifest(),
        'services:\n  app:\n    environment:\n      TZ: ${TIMEZONE}\n',
      ),
    ).toThrow(/"\$\{TIMEZONE\}".*not declared/);
  });

  test('accepts the "versions.key" variable without declaring it as an input or secret', () => {
    expect(() =>
      assertVariablesAreDeclared(
        manifest({ versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] } }),
        'services:\n  app:\n    image: sample:${APP_VERSION}\n',
      ),
    ).not.toThrow();
  });
});

describe('assertVersionsAreUsed', () => {
  test('does nothing when the template does not declare "versions"', () => {
    const parsed = parseComposeDocument('services:\n  app:\n    image: sample:1\n');

    expect(() => assertVersionsAreUsed(manifest(), parsed)).not.toThrow();
  });

  test('accepts a template whose image references "${key}"', () => {
    const versionedManifest = manifest({
      versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] },
    });
    const parsed = parseComposeDocument('services:\n  app:\n    image: sample:${APP_VERSION}\n');

    expect(() => assertVersionsAreUsed(versionedManifest, parsed)).not.toThrow();
  });

  test('rejects a template that declares "versions" but no image references "${key}"', () => {
    const versionedManifest = manifest({
      versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] },
    });
    const parsed = parseComposeDocument('services:\n  app:\n    image: sample:1\n');

    expect(() => assertVersionsAreUsed(versionedManifest, parsed)).toThrow(
      /"APP_VERSION".*no service "image"/,
    );
  });

  test('rejects an image that references "${key}" alongside a fixed digest', () => {
    const versionedManifest = manifest({
      versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] },
    });
    const parsed = parseComposeDocument(
      'services:\n  app:\n    image: sample:${APP_VERSION}@sha256:' + 'a'.repeat(64) + '\n',
    );

    expect(() => assertVersionsAreUsed(versionedManifest, parsed)).toThrow(
      /fixed digest at the same time/,
    );
  });
});

describe('assertDatabaseCredentialsAreDeclared', () => {
  test('accepts a password credential referencing a declared secret', () => {
    expect(() =>
      assertDatabaseCredentialsAreDeclared(
        manifest({
          databases: [
            {
              service: 'db',
              engine: 'postgresql',
              credentials: { password: { key: 'DB_PASSWORD' } },
            },
          ],
          secrets: [{ key: 'DB_PASSWORD', generate: 'password' }],
        }),
      ),
    ).not.toThrow();
  });

  test('accepts a literal credential value without declaring it', () => {
    expect(() =>
      assertDatabaseCredentialsAreDeclared(
        manifest({
          databases: [
            {
              service: 'db',
              engine: 'postgresql',
              credentials: { username: { value: 'postgres' }, password: { key: 'DB_PASSWORD' } },
            },
          ],
          secrets: [{ key: 'DB_PASSWORD', generate: 'password' }],
        }),
      ),
    ).not.toThrow();
  });

  test('rejects a credential key that is not declared in inputs or secrets', () => {
    expect(() =>
      assertDatabaseCredentialsAreDeclared(
        manifest({
          databases: [
            {
              service: 'db',
              engine: 'postgresql',
              credentials: { password: { key: 'DB_PASSWORD' } },
            },
          ],
        }),
      ),
    ).toThrow(/credentials\.password.*"DB_PASSWORD".*not declared/);
  });
});

describe('assertServiceExists', () => {
  const parsed = parseComposeDocument('services:\n  app:\n    image: nginx:1.27\n');

  test('accepts a service that exists in the compose file', () => {
    expect(() => assertServiceExists(parsed, 'app', 'expose.service')).not.toThrow();
  });

  test('rejects a service that does not exist in the compose file', () => {
    expect(() => assertServiceExists(parsed, 'db', 'expose.service')).toThrow(
      /expose\.service.*"db".*does not exist/,
    );
  });
});

describe('imagesOf', () => {
  test('extracts the distinct "image:" values from a compose document', () => {
    const compose =
      'services:\n  app:\n    image: louislam/uptime-kuma:${VERSION}\n' +
      '  db:\n    image: postgres:16\n';

    expect(imagesOf(compose)).toEqual(['louislam/uptime-kuma:${VERSION}', 'postgres:16']);
  });

  test('does not duplicate a repeated "image:" value', () => {
    const compose =
      'services:\n  app:\n    image: postgres:16\n  replica:\n    image: postgres:16\n';

    expect(imagesOf(compose)).toEqual(['postgres:16']);
  });
});

describe('repositoryForVersions', () => {
  const versions: TemplateVersions = {
    key: 'APP_VERSION',
    default: '2',
    available: [{ value: '2' }],
  };

  test('derives the repository from the single service referencing "${key}"', () => {
    const compose = 'services:\n  app:\n    image: louislam/uptime-kuma:${APP_VERSION}\n';

    expect(repositoryForVersions(versions, compose)).toBe('louislam/uptime-kuma');
  });

  test('derives the repository when the registry host and port are present', () => {
    const compose =
      'services:\n  app:\n    image: registry.example.com:5000/team/app:${APP_VERSION}\n';

    expect(repositoryForVersions(versions, compose)).toBe('registry.example.com:5000/team/app');
  });

  test('returns null when no service image references "${key}"', () => {
    const compose = 'services:\n  app:\n    image: louislam/uptime-kuma:2\n';

    expect(repositoryForVersions(versions, compose)).toBeNull();
  });

  test('returns null when more than one distinct repository references "${key}"', () => {
    const compose =
      'services:\n  app:\n    image: vendor-a/app:${APP_VERSION}\n' +
      '  worker:\n    image: vendor-b/worker:${APP_VERSION}\n';

    expect(repositoryForVersions(versions, compose)).toBeNull();
  });

  test('derives the repository even when the same image is used by two services', () => {
    const compose =
      'services:\n  app:\n    image: louislam/uptime-kuma:${APP_VERSION}\n' +
      '  replica:\n    image: louislam/uptime-kuma:${APP_VERSION}\n';

    expect(repositoryForVersions(versions, compose)).toBe('louislam/uptime-kuma');
  });
});

describe('assertVersionsRegistryHasRepository', () => {
  test('does nothing when the template does not declare "versions.registry"', () => {
    expect(() =>
      assertVersionsRegistryHasRepository(
        manifest({ versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }] } }),
        'services:\n  app:\n    image: sample:2\n',
      ),
    ).not.toThrow();
  });

  test('accepts a template whose repository is derivable', () => {
    const versionedManifest = manifest({
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { limit: 50 },
      },
    });

    expect(() =>
      assertVersionsRegistryHasRepository(
        versionedManifest,
        'services:\n  app:\n    image: louislam/uptime-kuma:${APP_VERSION}\n',
      ),
    ).not.toThrow();
  });

  test('rejects a template with "versions.registry" whose repository is not derivable', () => {
    const versionedManifest = manifest({
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { limit: 50 },
      },
    });

    expect(() =>
      assertVersionsRegistryHasRepository(
        versionedManifest,
        'services:\n  app:\n    image: vendor-a/app:${APP_VERSION}\n' +
          '  worker:\n    image: vendor-b/worker:${APP_VERSION}\n',
      ),
    ).toThrow(/versions\.registry.*exactly one/);
  });
});
