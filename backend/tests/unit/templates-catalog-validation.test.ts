import { describe, expect, test } from 'bun:test';
import { parseComposeDocument } from '../../src/modules/compose/compose.service';
import {
  assertDatabaseCredentialsAreDeclared,
  assertServiceExists,
  assertVariablesAreDeclared,
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
  expose: { service: 'app', port: 8080, domain: true },
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
