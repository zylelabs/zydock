import { describe, expect, test } from 'bun:test';
import {
  parseTemplateManifest,
  testVersionPattern,
} from '../../src/modules/templates/template.schema';

const validManifest = () => ({
  id: 'sample',
  version: 1,
  name: 'Sample',
  tagline: 'A sample template',
  category: 'automation',
  tags: ['sample'],
  icon: 'icon.svg',
  author: 'zydock',
  origin: 'official',
  docker_compose: 'docker-compose.yml',
  expose: { service: 'app', port: 8080 },
  databases: [],
  inputs: [],
  secrets: [],
});

describe('parseTemplateManifest', () => {
  test('accepts a valid manifest and converts snake_case to camelCase', () => {
    const manifest = parseTemplateManifest(validManifest());

    expect(manifest.dockerCompose).toBe('docker-compose.yml');
    expect(manifest.expose).toEqual({ service: 'app', port: 8080, kind: 'http', domain: true });
  });

  test('"expose.kind" defaults to "http" for a manifest that predates it', () => {
    const manifest = parseTemplateManifest(validManifest());

    expect(manifest.expose.kind).toBe('http');
  });

  test('accepts a "tcp" expose with a matching "host_port_key" number input', () => {
    const raw = {
      ...validManifest(),
      expose: {
        service: 'app',
        port: 25565,
        kind: 'tcp',
        host_port_key: 'HOST_PORT',
        domain: false,
      },
      inputs: [{ key: 'HOST_PORT', label: 'Host port', type: 'number', required: true }],
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.expose).toEqual({
      service: 'app',
      port: 25565,
      kind: 'tcp',
      host_port_key: 'HOST_PORT',
      domain: false,
    });
  });

  test('rejects "kind: tcp" without "host_port_key"', () => {
    const raw = { ...validManifest(), expose: { service: 'app', port: 25565, kind: 'tcp' } };

    expect(() => parseTemplateManifest(raw)).toThrow(/host_port_key.*required/);
  });

  test('rejects "host_port_key" when "kind" is "http"', () => {
    const raw = {
      ...validManifest(),
      expose: { service: 'app', port: 80, host_port_key: 'HOST_PORT' },
      inputs: [{ key: 'HOST_PORT', label: 'Host port', type: 'number', required: true }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/host_port_key.*not allowed/);
  });

  test('rejects "host_port_key" that does not match a declared input', () => {
    const raw = {
      ...validManifest(),
      expose: { service: 'app', port: 25565, kind: 'tcp', host_port_key: 'MISSING', domain: false },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/host_port_key.*must match/);
  });

  test('rejects "host_port_key" pointing at a non-"number" input', () => {
    const raw = {
      ...validManifest(),
      expose: {
        service: 'app',
        port: 25565,
        kind: 'tcp',
        host_port_key: 'HOST_PORT',
        domain: false,
      },
      inputs: [{ key: 'HOST_PORT', label: 'Host port', type: 'text', required: true }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/host_port_key.*type "number"/);
  });

  test('rejects "domain: true" when "kind" is not "http"', () => {
    const raw = {
      ...validManifest(),
      expose: { service: 'app', port: 25565, kind: 'udp', host_port_key: 'HOST_PORT' },
      inputs: [{ key: 'HOST_PORT', label: 'Host port', type: 'number', required: true }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/expose\.domain.*cannot be true/);
  });

  test('rejects an input key with the reserved ZYDOCK_ prefix', () => {
    const raw = {
      ...validManifest(),
      inputs: [{ key: 'ZYDOCK_DOMAIN', label: 'Domain', type: 'text', required: false }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/reserved/);
  });

  test('rejects a secret key with the reserved ZYDOCK_ prefix', () => {
    const raw = {
      ...validManifest(),
      secrets: [{ key: 'ZYDOCK_SERVER_HOST', generate: 'password' }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/reserved/);
  });

  test('rejects a "select" input without options', () => {
    const raw = {
      ...validManifest(),
      inputs: [{ key: 'MODE', label: 'Mode', type: 'select', required: false }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/require "options"/);
  });

  test('rejects an unknown secret generator', () => {
    const raw = { ...validManifest(), secrets: [{ key: 'TOKEN', generate: 'md5' }] };

    expect(() => parseTemplateManifest(raw)).toThrow();
  });

  test('rejects an id that is not lower kebab-case', () => {
    const raw = { ...validManifest(), id: 'Sample_App' };

    expect(() => parseTemplateManifest(raw)).toThrow();
  });

  test('the error message points at the offending field', () => {
    const raw = { ...validManifest(), expose: { service: 'app', port: 999999 } };

    expect(() => parseTemplateManifest(raw)).toThrow(/expose\.port/);
  });

  test('"deprecated" defaults to false', () => {
    const manifest = parseTemplateManifest(validManifest());

    expect(manifest.deprecated).toBe(false);
  });

  test('accepts an explicit "deprecated" flag', () => {
    const manifest = parseTemplateManifest({ ...validManifest(), deprecated: true });

    expect(manifest.deprecated).toBe(true);
  });

  test('rejects a database entry without a password credential', () => {
    const raw = {
      ...validManifest(),
      databases: [{ service: 'db', engine: 'postgresql' }],
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/credentials/);
  });

  test('accepts a database entry with a password credential referencing a secret key', () => {
    const raw = {
      ...validManifest(),
      databases: [
        {
          service: 'db',
          engine: 'postgresql',
          credentials: { password: { key: 'DB_PASSWORD' } },
        },
      ],
      secrets: [{ key: 'DB_PASSWORD', generate: 'password' }],
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.databases[0]?.credentials.password).toEqual({ key: 'DB_PASSWORD' });
  });

  test('accepts a literal value for username and database credentials', () => {
    const raw = {
      ...validManifest(),
      databases: [
        {
          service: 'db',
          engine: 'postgresql',
          credentials: {
            username: { value: 'postgres' },
            password: { key: 'DB_PASSWORD' },
            database: { value: 'postgres' },
          },
        },
      ],
      secrets: [{ key: 'DB_PASSWORD', generate: 'password' }],
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.databases[0]?.credentials.username).toEqual({ value: 'postgres' });
    expect(manifest.databases[0]?.credentials.database).toEqual({ value: 'postgres' });
  });

  test('accepts a "versions" block with a default present in "available"', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2', label: '2.x (stable)' }, { value: '1' }],
      },
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.versions).toEqual({
      key: 'APP_VERSION',
      default: '2',
      available: [{ value: '2', label: '2.x (stable)' }, { value: '1' }],
    });
  });

  test('"versions" is undefined when the template does not declare it', () => {
    const manifest = parseTemplateManifest(validManifest());

    expect(manifest.versions).toBeUndefined();
  });

  test('an empty "versions" block defaults to the VERSION key backed by the registry', () => {
    const manifest = parseTemplateManifest({ ...validManifest(), versions: {} });

    expect(manifest.versions).toEqual({
      key: 'VERSION',
      available: [],
      registry: { limit: 50 },
    });
  });

  test('"versions.default" alone keeps the registry as the version source', () => {
    const manifest = parseTemplateManifest({
      ...validManifest(),
      versions: { default: '3.3.0' },
    });

    expect(manifest.versions).toEqual({
      key: 'VERSION',
      default: '3.3.0',
      available: [],
      registry: { limit: 50 },
    });
  });

  test('a curated "available" without "registry" stays curated-only', () => {
    const manifest = parseTemplateManifest({
      ...validManifest(),
      versions: { available: [{ value: '2' }] },
    });

    expect(manifest.versions).toEqual({ key: 'VERSION', available: [{ value: '2' }] });
  });

  test('rejects "latest" as "versions.default"', () => {
    const raw = { ...validManifest(), versions: { default: 'latest' } };

    expect(() => parseTemplateManifest(raw)).toThrow(/"latest" is not allowed/);
  });

  test('rejects "versions.default" outside of "versions.available"', () => {
    const raw = {
      ...validManifest(),
      versions: { key: 'APP_VERSION', default: '3', available: [{ value: '2' }, { value: '1' }] },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/versions\.default.*"available/);
  });

  test('rejects "latest" as a "versions.available" value', () => {
    const raw = {
      ...validManifest(),
      versions: { key: 'APP_VERSION', default: 'latest', available: [{ value: 'latest' }] },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/latest.*not allowed/);
  });

  test('rejects duplicate "versions.available[].value" entries', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }, { value: '2' }],
      },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/available.*unique/);
  });

  test('rejects "versions.key" colliding with an "inputs" key', () => {
    const raw = {
      ...validManifest(),
      inputs: [{ key: 'APP_VERSION', label: 'Version', type: 'text', required: false }],
      versions: { key: 'APP_VERSION', default: '1', available: [{ value: '1' }] },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/versions\.key.*collides/);
  });

  test('rejects "versions.key" colliding with a "secrets" key', () => {
    const raw = {
      ...validManifest(),
      secrets: [{ key: 'APP_VERSION', generate: 'hex32' }],
      versions: { key: 'APP_VERSION', default: '1', available: [{ value: '1' }] },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/versions\.key.*collides/);
  });

  test('rejects "versions.key" with the reserved ZYDOCK_ prefix', () => {
    const raw = {
      ...validManifest(),
      versions: { key: 'ZYDOCK_APP_VERSION', default: '1', available: [{ value: '1' }] },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/reserved/);
  });

  test('rejects "versions.available" with more than 30 entries', () => {
    const available = Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1) }));
    const raw = {
      ...validManifest(),
      versions: { key: 'APP_VERSION', default: '1', available },
    };

    expect(() => parseTemplateManifest(raw)).toThrow();
  });

  test('accepts "versions.registry" with "include", "exclude" and "limit"', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { include: '^v?\\d+(\\.\\d+){0,2}$', exclude: '-alpine$', limit: 100 },
      },
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.versions?.registry).toEqual({
      include: '^v?\\d+(\\.\\d+){0,2}$',
      exclude: '-alpine$',
      limit: 100,
    });
  });

  test('"versions.registry.limit" defaults to 50', () => {
    const raw = {
      ...validManifest(),
      versions: { key: 'APP_VERSION', default: '2', available: [{ value: '2' }], registry: {} },
    };

    const manifest = parseTemplateManifest(raw);

    expect(manifest.versions?.registry?.limit).toBe(50);
  });

  test('rejects "versions.registry.limit" above 200', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { limit: 201 },
      },
    };

    expect(() => parseTemplateManifest(raw)).toThrow();
  });

  test('rejects an invalid "versions.registry.include" regular expression', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { include: '(unterminated' },
      },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/versions\.registry\.include.*not a valid/);
  });

  test('rejects an invalid "versions.registry.exclude" regular expression', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { exclude: '[' },
      },
    };

    expect(() => parseTemplateManifest(raw)).toThrow(/versions\.registry\.exclude.*not a valid/);
  });

  test('rejects a "versions.registry.include" pattern longer than 200 characters', () => {
    const raw = {
      ...validManifest(),
      versions: {
        key: 'APP_VERSION',
        default: '2',
        available: [{ value: '2' }],
        registry: { include: `^(${'a'.repeat(210)})$` },
      },
    };

    expect(() => parseTemplateManifest(raw)).toThrow();
  });
});

describe('testVersionPattern', () => {
  test('matches a value against the pattern', () => {
    expect(testVersionPattern('^v?\\d+(\\.\\d+){0,2}$', '2.1.3')).toBe(true);
    expect(testVersionPattern('^v?\\d+(\\.\\d+){0,2}$', '2.1.3-alpine')).toBe(false);
  });

  test('truncates the input to the maximum tag length before testing', () => {
    const oversized = '9'.repeat(130);

    expect(new RegExp('^9{128}$').test(oversized)).toBe(false);
    expect(testVersionPattern('^9{128}$', oversized)).toBe(true);
  });
});
