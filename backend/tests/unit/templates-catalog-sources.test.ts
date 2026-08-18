import { mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  allTemplates,
  catalogCollisions,
  refreshComposedCatalog,
  sourceCacheDirOf,
} from '../../src/modules/templates/catalog.service';

const composeContent = 'services:\n  app:\n    image: nginx:1.27\n';

const manifestOf = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  name: id,
  tagline: 'Synthetic source template',
  category: 'test',
  tags: [],
  icon: 'icon.svg',
  author: 'community-author',
  origin: 'official',
  docker_compose: 'docker-compose.yml',
  expose: { service: 'app', port: 80 },
  databases: [],
  inputs: [],
  secrets: [],
  ...overrides,
});

const writeTemplateDir = async (sourceId: string, templateId: string, manifest: unknown) => {
  const dir = `${sourceCacheDirOf(sourceId)}/${templateId}`;

  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/template.json`, JSON.stringify(manifest));
  await writeFile(`${dir}/docker-compose.yml`, composeContent);
  await writeFile(`${dir}/icon.svg`, '<svg></svg>');
};

const sourceIds: string[] = [];

afterEach(async () => {
  refreshComposedCatalog([]);

  await Promise.all(
    sourceIds.splice(0).map(id => rm(sourceCacheDirOf(id), { recursive: true, force: true })),
  );
});

describe('catalog.service: external sources', () => {
  test('a valid external source is composed with the embedded catalog, and its templates are always "community"', async () => {
    const sourceId = `test-source-valid-${Date.now()}`;

    sourceIds.push(sourceId);

    await writeTemplateDir(
      sourceId,
      'synthetic-community-app',
      manifestOf('synthetic-community-app', { origin: 'official' }),
    );

    refreshComposedCatalog([{ id: sourceId, enabled: true }]);

    const template = allTemplates().find(item => item.id === 'synthetic-community-app');

    expect(template).toBeDefined();
    expect(template!.origin).toBe('community');
    expect(allTemplates().some(item => item.id === 'excalidraw')).toBe(true);
  });

  test('a source with one invalid template is rejected as a whole', async () => {
    const sourceId = `test-source-invalid-${Date.now()}`;

    sourceIds.push(sourceId);

    await writeTemplateDir(sourceId, 'synthetic-valid-app', manifestOf('synthetic-valid-app'));
    await writeTemplateDir(
      sourceId,
      'synthetic-broken-app',
      manifestOf('synthetic-broken-app', { expose: { service: 'does-not-exist', port: 80 } }),
    );

    expect(() => refreshComposedCatalog([{ id: sourceId, enabled: true }])).toThrow();

    // refreshComposedCatalog threw, so the module keeps serving whatever was composed before —
    // never a half-loaded source.
    expect(allTemplates().some(item => item.id === 'synthetic-valid-app')).toBe(false);
    expect(allTemplates().some(item => item.id === 'synthetic-broken-app')).toBe(false);
  });

  test('a template id colliding with the embedded catalog keeps the embedded one and records the collision', async () => {
    const sourceId = `test-source-collide-${Date.now()}`;

    sourceIds.push(sourceId);

    await writeTemplateDir(sourceId, 'excalidraw', manifestOf('excalidraw'));

    refreshComposedCatalog([{ id: sourceId, enabled: true }]);

    const matches = allTemplates().filter(item => item.id === 'excalidraw');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.origin).toBe('official');
    expect(catalogCollisions()).toContainEqual({
      templateId: 'excalidraw',
      sourceId,
      keptBy: 'embedded',
    });
  });
});
