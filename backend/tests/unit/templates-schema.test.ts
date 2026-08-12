import { describe, expect, test } from 'bun:test';
import { parseTemplateManifest } from '../../src/modules/templates/template.schema';

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
    expect(manifest.expose).toEqual({ service: 'app', port: 8080, domain: true });
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
});
