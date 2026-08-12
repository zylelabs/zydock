import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { MAX_COMPOSE_FILE_BYTES, validateComposeSecurity } from '../compose/compose.schema';
import { parseComposeDocument } from '../compose/compose.service';
import { parseTemplateManifest } from './template.schema';

const CATALOG_ROOT = resolve(import.meta.dir, 'catalog');

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

const loadTemplate = (id: string): Template => {
  const dir = join(CATALOG_ROOT, id);
  const manifest = parseTemplateManifest(
    JSON.parse(readFileSync(join(dir, 'template.json'), 'utf-8')),
  );

  if (manifest.id !== id) {
    throw new Error(`"id" ("${manifest.id}") does not match the catalog folder name ("${id}")`);
  }

  const composePath = composeFilePathOf(dir, manifest.dockerCompose);
  const composeContent = readFileSync(composePath, 'utf-8');

  if (Buffer.byteLength(composeContent) > MAX_COMPOSE_FILE_BYTES) {
    throw new Error('"docker-compose.yml" exceeds the maximum allowed size');
  }

  const parsed = parseComposeDocument(composeContent);

  assertServiceExists(parsed, manifest.expose.service, 'expose.service');

  for (const database of manifest.databases) {
    assertServiceExists(parsed, database.service, `databases[].service ("${database.service}")`);
  }

  assertVariablesAreDeclared(manifest, composeContent);
  assertDatabaseCredentialsAreDeclared(manifest);
  validateComposeSecurity(parsed);

  if (manifest.icon) {
    statSync(join(dir, manifest.icon));
  }

  return { ...manifest, dockerComposeContent: composeContent };
};

const loadCatalog = (): Template[] =>
  readdirSync(CATALOG_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .map(id => {
      try {
        return loadTemplate(id);
      } catch (error) {
        throw new Error(
          `Invalid template "${id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

const catalog = loadCatalog();

export const allTemplates = (): Template[] => catalog;
