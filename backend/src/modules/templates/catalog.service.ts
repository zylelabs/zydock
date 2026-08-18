import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import config from '../../config';
import { MAX_COMPOSE_FILE_BYTES, validateComposeSecurity } from '../compose/compose.schema';
import { parseComposeDocument } from '../compose/compose.service';
import {
  DEFAULT_VERSION_KEY,
  implicitTemplateVersions,
  parseTemplateManifest,
} from './template.schema';

const CATALOG_ROOT = resolve(config.templates.catalogPath);
const SOURCES_CACHE_ROOT = resolve(config.templates.sourcesCachePath);

const ICON_CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?][^}]*)?\}/g;

const composeFilePathOf = (templateDir: string, relative: string) => {
  const target = resolve(templateDir, relative);

  if (target !== templateDir && !target.startsWith(`${templateDir}${sep}`)) {
    throw new Error(`"docker_compose" ("${relative}") escapes the template folder`);
  }

  return target;
};

const referencedVariablesOf = (content: string): string[] =>
  [...content.matchAll(VARIABLE_PATTERN)].map(match => match[1]);

export const assertVariablesAreDeclared = (manifest: TemplateManifest, composeContent: string) => {
  const declared = new Set([
    ...manifest.inputs.map(input => input.key),
    ...manifest.secrets.map(secret => secret.key),
    ...(manifest.versions ? [manifest.versions.key] : []),
  ]);

  for (const variable of referencedVariablesOf(composeContent)) {
    if (variable.startsWith('ZYDOCK_') || declared.has(variable)) {
      continue;
    }

    throw new Error(
      `Variable "\${${variable}}" is used in the compose file but is not declared in "inputs" or "secrets"`,
    );
  }
};

export const assertVersionsAreUsed = (manifest: TemplateManifest, parsed: ParsedCompose) => {
  if (!manifest.versions) {
    return;
  }

  const { key } = manifest.versions;
  const referencePattern = new RegExp(`\\$\\{${key}(:?[-?][^}]*)?\\}`);
  const referencing = parsed.services.filter(
    service => service.image && referencePattern.test(service.image),
  );

  if (referencing.length === 0) {
    throw new Error(
      `"versions.key" ("${key}") is declared but no service "image" references "\${${key}}"`,
    );
  }

  const withFixedDigest = referencing.find(service => service.image?.includes('@sha256:'));

  if (withFixedDigest) {
    throw new Error(
      `Service "${withFixedDigest.name}": image references "\${${key}}" and a fixed digest at the ` +
        `same time`,
    );
  }
};

export const imagesOf = (composeYaml: string): string[] => [
  ...new Set(Array.from(composeYaml.matchAll(/^\s*image:\s*(\S+)\s*$/gm)).map(match => match[1])),
];

export const repositoryForVersions = (
  versions: TemplateVersions,
  composeContent: string,
): string | null => {
  const referencePattern = new RegExp(`\\$\\{${versions.key}(:?[-?][^}]*)?\\}`);
  const tagPattern = new RegExp(`:\\$\\{${versions.key}(:?[-?][^}]*)?\\}$`);
  const repositories = new Set(
    imagesOf(composeContent)
      .filter(image => referencePattern.test(image))
      .map(image => image.replace(tagPattern, '')),
  );

  return repositories.size === 1 ? [...repositories][0]! : null;
};

export const assertVersionsRegistryHasRepository = (
  manifest: TemplateManifest,
  composeContent: string,
) => {
  if (!manifest.versions?.registry) {
    return;
  }

  if (!repositoryForVersions(manifest.versions, composeContent)) {
    throw new Error(
      `"versions.registry" requires exactly one service image referencing "\${${manifest.versions.key}}"`,
    );
  }
};

export const assertServiceExists = (parsed: ParsedCompose, service: string, field: string) => {
  if (!parsed.services.some(candidate => candidate.name === service)) {
    throw new Error(
      `"${field}" references service "${service}", which does not exist in the compose file`,
    );
  }
};

export const assertDatabaseCredentialsAreDeclared = (manifest: TemplateManifest) => {
  const declared = new Set([
    ...manifest.inputs.map(input => input.key),
    ...manifest.secrets.map(secret => secret.key),
  ]);

  for (const database of manifest.databases) {
    for (const [field, ref] of Object.entries(database.credentials)) {
      if (!ref || ref.value !== undefined || !ref.key) {
        continue;
      }

      if (!declared.has(ref.key)) {
        throw new Error(
          `databases[].credentials.${field} references "${ref.key}", which is not declared in ` +
            `"inputs" or "secrets"`,
        );
      }
    }
  }
};

const implicitVersionReference = new RegExp(`\\$\\{${DEFAULT_VERSION_KEY}(:?[-?][^}]*)?\\}`);

export const withImplicitVersions = (
  manifest: TemplateManifest,
  composeContent: string,
): TemplateManifest => {
  if (manifest.versions) {
    return manifest;
  }

  const declaredKeys = new Set([
    ...manifest.inputs.map(input => input.key),
    ...manifest.secrets.map(secret => secret.key),
  ]);

  if (declaredKeys.has(DEFAULT_VERSION_KEY)) {
    return manifest;
  }

  const referenced = imagesOf(composeContent).some(image => implicitVersionReference.test(image));

  return referenced ? { ...manifest, versions: implicitTemplateVersions() } : manifest;
};

const loadTemplate = (catalogRoot: string, id: string): Template => {
  const dir = join(catalogRoot, id);
  const parsedManifest = parseTemplateManifest(
    JSON.parse(readFileSync(join(dir, 'template.json'), 'utf-8')),
  );

  if (parsedManifest.id !== id) {
    throw new Error(
      `"id" ("${parsedManifest.id}") does not match the catalog folder name ("${id}")`,
    );
  }

  const composePath = composeFilePathOf(dir, parsedManifest.dockerCompose);
  const composeContent = readFileSync(composePath, 'utf-8');

  if (Buffer.byteLength(composeContent) > MAX_COMPOSE_FILE_BYTES) {
    throw new Error('"docker-compose.yml" exceeds the maximum allowed size');
  }

  const manifest = withImplicitVersions(parsedManifest, composeContent);
  const parsed = parseComposeDocument(composeContent);

  assertServiceExists(parsed, manifest.expose.service, 'expose.service');

  for (const database of manifest.databases) {
    assertServiceExists(parsed, database.service, `databases[].service ("${database.service}")`);
  }

  assertVariablesAreDeclared(manifest, composeContent);
  assertDatabaseCredentialsAreDeclared(manifest);
  assertVersionsAreUsed(manifest, parsed);
  assertVersionsRegistryHasRepository(manifest, composeContent);
  validateComposeSecurity(parsed);

  if (manifest.icon) {
    statSync(join(dir, manifest.icon));
  }

  return { ...manifest, dockerComposeContent: composeContent };
};

const loadCatalogFrom = (catalogRoot: string): Template[] => {
  if (!existsSync(catalogRoot)) {
    throw new Error(`Template catalog not found at "${catalogRoot}".`);
  }

  return readdirSync(catalogRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
    .map(id => {
      try {
        return loadTemplate(catalogRoot, id);
      } catch (error) {
        throw new Error(
          `Invalid template "${id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
};

/**
 * Validates every template of an external catalog directory before it is trusted, using the same
 * checks as the embedded catalog. Throws on the first invalid template — a source is accepted as a
 * whole or not at all.
 */
export const validateCatalogDirectory = (catalogRoot: string): Template[] =>
  loadCatalogFrom(catalogRoot);

export const sourceCacheDirOf = (sourceId: string) => join(SOURCES_CACHE_ROOT, sourceId);

const loadEmbeddedCatalog = (): Template[] => loadCatalogFrom(CATALOG_ROOT);

const loadSourceCatalog = (sourceId: string): Template[] => {
  const dir = sourceCacheDirOf(sourceId);

  if (!existsSync(dir)) {
    return [];
  }

  // The source is validated in full before it ever reaches the cache directory (see
  // `template-source.service.ts`), so `origin` is the only thing rewritten here: a template from an
  // external source is always "community", no matter what the manifest declares.
  return loadCatalogFrom(dir).map(template => ({ ...template, origin: 'community' as const }));
};

export type CatalogSource = { id: string; enabled: boolean };

export type CatalogCollision = { templateId: string; sourceId: string; keptBy: string };

type ComposedCatalog = {
  templates: Template[];
  collisions: CatalogCollision[];
  rootById: Map<string, string>;
};

const composeCatalog = (sources: CatalogSource[]): ComposedCatalog => {
  const embedded = loadEmbeddedCatalog();
  const templates = new Map<string, Template>(embedded.map(template => [template.id, template]));
  const ownerById = new Map<string, string>(embedded.map(template => [template.id, 'embedded']));
  const rootById = new Map<string, string>(embedded.map(template => [template.id, CATALOG_ROOT]));
  const collisions: CatalogCollision[] = [];

  for (const source of sources.filter(candidate => candidate.enabled)) {
    for (const template of loadSourceCatalog(source.id)) {
      if (templates.has(template.id)) {
        collisions.push({
          templateId: template.id,
          sourceId: source.id,
          keptBy: ownerById.get(template.id)!,
        });

        continue;
      }

      templates.set(template.id, template);
      ownerById.set(template.id, source.id);
      rootById.set(template.id, sourceCacheDirOf(source.id));
    }
  }

  return { templates: [...templates.values()], collisions, rootById };
};

let composed: ComposedCatalog | undefined;

export const readTemplateIcon = (
  template: Template,
): { content: Buffer; contentType: string } => {
  const root = composed?.rootById.get(template.id) ?? CATALOG_ROOT;
  const iconPath = join(root, template.id, template.icon!);
  const contentType = ICON_CONTENT_TYPES[extname(iconPath).toLowerCase()] ?? 'application/octet-stream';

  return { content: readFileSync(iconPath), contentType };
};

export const allTemplates = (): Template[] => {
  if (!composed) {
    composed = composeCatalog([]);
  }

  return composed.templates;
};

export const catalogCollisions = (): CatalogCollision[] => composed?.collisions ?? [];

/**
 * Rebuilds the composed catalog from whatever is currently cached on disk for the given sources.
 * Called once the database is reachable (the embedded catalog alone is validated at boot, before
 * MongoDB is even connected) and again after any source is created, removed or (re)synced — never
 * during the request itself, so a broken network never empties the marketplace.
 */
export const refreshComposedCatalog = (sources: CatalogSource[]): void => {
  composed = composeCatalog(sources);
};
