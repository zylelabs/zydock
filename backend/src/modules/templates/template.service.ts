import { createHash, randomBytes, randomUUID } from 'node:crypto';
import config from '../../config';
import { errorMessage } from '../../utils';
import { logWarn } from '../../utils/logger';
import { listRegistryTags, registryTagExists } from '../../providers/registry';
import {
  createApplication,
  decryptVariables,
  removeApplication,
  uniqueSlug,
  updateTemplateApplication,
  updateVariableValue,
} from '../applications/application.service';
import type { CreateApplicationDTO } from '../applications/application.schema';
import { findHostPortConflict } from '../applications/port-guard.service';
import { registryReferenceOf, validateComposeSecurity } from '../compose/compose.schema';
import { parseComposeDocument, publishedPortsOf } from '../compose/compose.service';
import { ensureAutoDomain } from '../domains/auto-domain.service';
import {
  findDatabasesOfApplication,
  registerComposeDatabases,
  unlinkComposeDatabasesOfServices,
} from '../databases/database.service';
import { enqueueDeployment } from '../deployments/pipeline.service';
import { findServerById } from '../servers/server.service';
import { allTemplates, repositoryForVersions } from './catalog.service';
import { parseEnvContent, renderTemplate, type RenderTemplateContext } from './render.service';
import { DEFAULT_VERSION_INCLUDE_PATTERN, testVersionPattern } from './template.schema';
import type {
  DeployTemplateDTO,
  ListTemplatesQuery,
  TemplateSecretGenerator,
} from './template.schema';

export const findTemplateById = (templateId: string): Template | undefined =>
  allTemplates().find(template => template.id === templateId);

const matchesSearch = (template: Template, search?: string) => {
  if (!search) {
    return true;
  }

  const needle = search.trim().toLowerCase();

  return (
    template.name.toLowerCase().includes(needle) ||
    template.tagline.toLowerCase().includes(needle) ||
    template.tags.some(tag => tag.toLowerCase().includes(needle))
  );
};

const matchesCategory = (template: Template, category?: string) =>
  !category || template.category === category;

export const listTemplates = ({
  search,
  category,
  page,
  size,
}: ListTemplatesQuery & { page: number; size: number }) => {
  const filtered = allTemplates().filter(
    template =>
      !template.deprecated &&
      matchesSearch(template, search) &&
      matchesCategory(template, category),
  );

  const skip = (page - 1) * size;
  const items = filtered.slice(skip, skip + size);

  return {
    items: items.map(serializeTemplate),
    total: filtered.length,
    page,
    size,
    pages: Math.max(1, Math.ceil(filtered.length / size)),
  };
};

export const serializeTemplate = (template: Template) => ({
  id: template.id,
  version: template.version,
  name: template.name,
  tagline: template.tagline,
  category: template.category,
  tags: template.tags,
  icon: template.icon,
  website: template.website,
  documentation: template.documentation,
  license: template.license,
  author: template.author,
  origin: template.origin,
  deprecated: template.deprecated,
  expose: template.expose,
  databases: template.databases,
  inputs: template.inputs,
  secrets: template.secrets.map(secret => ({ key: secret.key, generate: secret.generate })),
  versions: template.versions,
});

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 24;
const HEX32_BYTES = 16;

export const generateSecretValue = (generator: TemplateSecretGenerator): string => {
  if (generator === 'password') {
    return Array.from(
      randomBytes(PASSWORD_LENGTH),
      byte => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length],
    ).join('');
  }

  if (generator === 'hex32') {
    return randomBytes(HEX32_BYTES).toString('hex');
  }

  return randomUUID();
};

export const regenerateTemplateSecret = async (application: Application, key: string) => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    throw new Error('This application was not created from a template');
  }

  const template = findTemplateById(application.origin.templateId);
  const secret = template?.secrets.find(candidate => candidate.key === key);

  if (!secret) {
    throw new Error(`"${key}" is not a generated secret of this application's template`);
  }

  const value = generateSecretValue(secret.generate);

  await updateVariableValue(String(application._id), key, value);
};

export const changeApplicationVersion = async (application: Application, version: string) => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    throw new Error('This application was not created from a template');
  }

  const template = findTemplateById(application.origin.templateId);

  if (!template) {
    throw new Error('The template this application was created from is no longer in the catalog');
  }

  if (!template.versions) {
    throw new Error('This template has no selectable versions');
  }

  if (!isVersionAllowed(template, version)) {
    throw new Error(versionPolicyMessage(template, version));
  }

  await assertVersionExistsBestEffort(template, version);

  const current = decryptVariables(application.variables).find(
    variable => variable.key === template.versions!.key,
  );

  if (current?.value === version) {
    throw new Error('The application is already running this version');
  }

  await updateVariableValue(String(application._id), template.versions.key, version);
};

export type TemplateVersionOption = {
  value: string;
  label?: string;
  updatedAt?: Date;
  origin: 'catalog' | 'registry';
};

export type TemplateVersionsListing = {
  source: 'catalog' | 'registry' | 'mixed';
  versions: TemplateVersionOption[];
  fetchedAt?: Date;
  degraded?: { reason: string };
};

const SEMVER_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

const semverOf = (value: string): [number, number, number] | null => {
  const match = SEMVER_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2] ?? '0'), Number(match[3] ?? '0')];
};

const versionCollator = new Intl.Collator(undefined, { numeric: true });

const sortRegistryOptions = (options: TemplateVersionOption[]): TemplateVersionOption[] => {
  const allSemver = options.every(option => semverOf(option.value) !== null);

  if (allSemver) {
    return [...options].sort((a, b) => {
      const semverA = semverOf(a.value)!;
      const semverB = semverOf(b.value)!;

      for (let i = 0; i < 3; i += 1) {
        if (semverA[i] !== semverB[i]) {
          return semverB[i]! - semverA[i]!;
        }
      }

      return versionCollator.compare(b.value, a.value);
    });
  }

  return [...options].sort((a, b) => {
    const timeA = a.updatedAt?.getTime();
    const timeB = b.updatedAt?.getTime();

    if (timeA !== undefined && timeB !== undefined && timeA !== timeB) {
      return timeB - timeA;
    }

    if (timeA !== undefined && timeB === undefined) {
      return -1;
    }

    if (timeA === undefined && timeB !== undefined) {
      return 1;
    }

    return versionCollator.compare(b.value, a.value);
  });
};

const matchesVersionSearch = (option: TemplateVersionOption, search?: string): boolean => {
  if (!search) {
    return true;
  }

  const needle = search.trim().toLowerCase();

  return (
    option.value.toLowerCase().includes(needle) ||
    (option.label?.toLowerCase().includes(needle) ?? false)
  );
};

const TAG_FORMAT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export const isVersionAllowed = (template: Template, value: string): boolean => {
  if (!template.versions || value === 'latest' || !TAG_FORMAT_PATTERN.test(value)) {
    return false;
  }

  if (template.versions.available.some(entry => entry.value === value)) {
    return true;
  }

  const registry = template.versions.registry;

  if (!registry) {
    return false;
  }

  const includePattern = registry.include ?? DEFAULT_VERSION_INCLUDE_PATTERN;

  if (!testVersionPattern(includePattern, value)) {
    return false;
  }

  return !registry.exclude || !testVersionPattern(registry.exclude, value);
};

const versionPolicyMessage = (template: Template, value: string): string => {
  const versions = template.versions!;
  const registry = versions.registry;

  if (!registry) {
    const options = versions.available.map(entry => entry.value).join(', ');

    return `"version" must be one of: ${options}`;
  }

  const includePattern = registry.include ?? DEFAULT_VERSION_INCLUDE_PATTERN;
  const excludeClause = registry.exclude ? ` and not match "${registry.exclude}"` : '';

  return (
    `"${value}" is not an allowed version for this template: it must match "${includePattern}"` +
    `${excludeClause}. See GET /templates/${template.id}/versions for the current list.`
  );
};

const assertVersionExistsBestEffort = async (template: Template, value: string): Promise<void> => {
  const registry = template.versions?.registry;

  if (!registry || !config.providers.registry.enabled) {
    return;
  }

  if (template.versions!.available.some(entry => entry.value === value)) {
    return;
  }

  const repository = repositoryForVersions(template.versions!, template.dockerComposeContent);

  if (!repository) {
    return;
  }

  const { host, path } = registryReferenceOf(repository);
  const exists = await registryTagExists(host, path, value);

  if (exists === false) {
    throw new Error(
      `"${value}" was not found in the registry for "${repository}" — check the tag and try again`,
    );
  }
};

export const listTemplateVersions = async (
  template: Template,
  options: { search?: string } = {},
): Promise<TemplateVersionsListing> => {
  if (!template.versions) {
    throw new Error('This template has no selectable versions');
  }

  const curated: TemplateVersionOption[] = template.versions.available.map(entry => ({
    value: entry.value,
    label: entry.label,
    origin: 'catalog',
  }));
  const curatedListing = (): TemplateVersionsListing => ({
    source: 'catalog',
    versions: curated.filter(option => matchesVersionSearch(option, options.search)),
  });

  const registry = template.versions.registry;

  if (!registry || !config.providers.registry.enabled) {
    return curatedListing();
  }

  const repository = repositoryForVersions(template.versions, template.dockerComposeContent);

  if (!repository) {
    return curatedListing();
  }

  const { host, path } = registryReferenceOf(repository);
  const curatedValues = new Set(curated.map(option => option.value));
  const includePattern = registry.include ?? DEFAULT_VERSION_INCLUDE_PATTERN;

  try {
    const tags = await listRegistryTags(host, path);

    if (!tags) {
      return curatedListing();
    }

    const registryOptions = sortRegistryOptions(
      tags
        .filter(tag => tag.name !== 'latest')
        .filter(tag => !curatedValues.has(tag.name))
        .filter(tag => testVersionPattern(includePattern, tag.name))
        .filter(tag => !registry.exclude || !testVersionPattern(registry.exclude, tag.name))
        .map(tag => ({ value: tag.name, updatedAt: tag.updatedAt, origin: 'registry' as const })),
    )
      .filter(option => matchesVersionSearch(option, options.search))
      .slice(0, registry.limit);

    return {
      source: 'mixed',
      versions: [
        ...curated.filter(option => matchesVersionSearch(option, options.search)),
        ...registryOptions,
      ],
      fetchedAt: new Date(),
    };
  } catch (error) {
    const reason = errorMessage(error);

    logWarn('Registry did not answer, falling back to the curated version list', {
      templateId: template.id,
      repository,
      error: reason,
    });

    return { ...curatedListing(), degraded: { reason } };
  }
};

export const composeHashOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex');

export const TEMPLATE_STATUSES = [
  'up-to-date',
  'update-available',
  'deprecated',
  'unknown',
] as const;

export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const templateStatusOf = (application: Application): TemplateStatus | undefined => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    return undefined;
  }

  const template = findTemplateById(application.origin.templateId);

  if (!template) {
    return 'unknown';
  }

  if (template.deprecated) {
    return 'deprecated';
  }

  return template.version > application.origin.templateVersion ? 'update-available' : 'up-to-date';
};

export type ComposeDiffLine = { type: 'context' | 'added' | 'removed'; content: string };

const diffComposeLines = (before: string[], after: string[]): ComposeDiffLine[] => {
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        before[i] === after[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const result: ComposeDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      result.push({ type: 'context', content: before[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      result.push({ type: 'removed', content: before[i]! });
      i += 1;
    } else {
      result.push({ type: 'added', content: after[j]! });
      j += 1;
    }
  }

  while (i < before.length) {
    result.push({ type: 'removed', content: before[i]! });
    i += 1;
  }

  while (j < after.length) {
    result.push({ type: 'added', content: after[j]! });
    j += 1;
  }

  return result;
};

export const diffComposeContent = (before: string, after: string): ComposeDiffLine[] =>
  diffComposeLines(before.split('\n'), after.split('\n'));

export type TemplateUpdatePreview = {
  status: TemplateStatus;
  installedVersion: number;
  availableVersion?: number;
  manuallyEdited: boolean;
  composeDiff?: ComposeDiffLine[];
  variables?: { added: string[]; removed: string[] };
  expose?: { changed: boolean; current: ApplicationComposeExpose; next: TemplateExpose };
  databases?: {
    added: { service: string; engine: string }[];
    removed: { service: string; engine: string }[];
  };
};

export const composeIsManuallyEdited = (application: Application): boolean => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    return false;
  }

  const composeContent = application.compose?.content ?? '';

  return application.origin.composeHash
    ? composeHashOf(composeContent) !== application.origin.composeHash
    : true;
};

export const buildTemplateUpdatePreview = async (
  application: Application,
): Promise<TemplateUpdatePreview> => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    throw new Error('This application was not created from a template');
  }

  const composeContent = application.compose?.content ?? '';

  const preview: TemplateUpdatePreview = {
    status: templateStatusOf(application)!,
    installedVersion: application.origin.templateVersion,
    manuallyEdited: composeIsManuallyEdited(application),
  };

  const template = findTemplateById(application.origin.templateId);

  if (!template) {
    return preview;
  }

  preview.availableVersion = template.version;
  preview.composeDiff = diffComposeContent(composeContent, template.dockerComposeContent);

  const declaredKeys = new Set([
    ...template.inputs.map(input => input.key),
    ...template.secrets.map(secret => secret.key),
  ]);
  const existingKeys = new Set(
    application.variables
      .map(variable => variable.key)
      .filter(key => key !== template.versions?.key && !key.startsWith('ZYDOCK_')),
  );

  preview.variables = {
    added: [...declaredKeys].filter(key => !existingKeys.has(key)),
    removed: [...existingKeys].filter(key => !declaredKeys.has(key)),
  };

  preview.expose = {
    changed:
      application.compose?.expose.service !== template.expose.service ||
      application.compose?.expose.port !== template.expose.port,
    current: application.compose?.expose ?? { service: '', port: 0 },
    next: template.expose,
  };

  const registered = await findDatabasesOfApplication(String(application._id));
  const registeredServices = new Map(
    registered.map(database => [database.link!.service, database.engine]),
  );
  const templateServices = new Set(template.databases.map(database => database.service));

  preview.databases = {
    added: template.databases
      .filter(database => !registeredServices.has(database.service))
      .map(database => ({ service: database.service, engine: database.engine })),
    removed: [...registeredServices.entries()]
      .filter(([service]) => !templateServices.has(service))
      .map(([service, engine]) => ({ service, engine })),
  };

  return preview;
};

export const applyTemplateUpdate = async (
  application: Application,
  inputs: Record<string, string>,
): Promise<{ versionFellBackToDefault: boolean }> => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    throw new Error('This application was not created from a template');
  }

  const template = findTemplateById(application.origin.templateId);

  if (!template) {
    throw new Error('The template this application was created from is no longer in the catalog');
  }

  if (template.deprecated) {
    throw new Error('This template was taken off the marketplace and no longer offers updates');
  }

  if (template.version === application.origin.templateVersion) {
    throw new Error('This application is already on the latest template version');
  }

  const secretKeys = new Set(template.secrets.map(secret => secret.key));

  for (const key of Object.keys(inputs)) {
    if (secretKeys.has(key)) {
      throw new Error(`"${key}" is generated by the server and cannot be provided as an input`);
    }

    if (template.versions?.key === key) {
      throw new Error(`"${key}" is the version selector and cannot be provided as an input`);
    }
  }

  const declaredKeys = new Set([
    ...template.inputs.map(input => input.key),
    ...secretKeys,
    ...(template.versions ? [template.versions.key] : []),
  ]);

  const existingByKey = new Map(
    decryptVariables(application.variables).map(variable => [variable.key, variable.value]),
  );

  const preservedAnswers = Object.fromEntries(
    [...existingByKey.entries()].filter(([key]) => declaredKeys.has(key)),
  );

  const defaults = Object.fromEntries(
    template.inputs
      .filter(
        input =>
          input.default !== undefined &&
          preservedAnswers[input.key] === undefined &&
          inputs[input.key] === undefined,
      )
      .map(input => [input.key, String(input.default)]),
  );

  const values = { ...defaults, ...preservedAnswers, ...inputs };

  const missingRequiredInputs = template.inputs
    .filter(input => input.required && values[input.key] === undefined)
    .map(input => input.key);

  if (missingRequiredInputs.length > 0) {
    throw new Error(`Missing required input(s): ${missingRequiredInputs.join(', ')}`);
  }

  const currentVersion = template.versions ? existingByKey.get(template.versions.key) : undefined;
  const versionStillValid = Boolean(
    currentVersion !== undefined && isVersionAllowed(template, currentVersion),
  );
  const versionFellBackToDefault = Boolean(template.versions) && !versionStillValid;
  const versionAnswer = template.versions
    ? { [template.versions.key]: versionStillValid ? currentVersion! : template.versions.default }
    : {};

  const newSecretValues = Object.fromEntries(
    template.secrets
      .filter(secret => existingByKey.get(secret.key) === undefined)
      .map(secret => [secret.key, generateSecretValue(secret.generate)]),
  );

  const answers = { ...preservedAnswers, ...inputs, ...newSecretValues, ...versionAnswer };

  const server = await findServerById(String(application.serverId));

  if (!server) {
    throw new Error('The server this application runs on no longer exists');
  }

  const context: RenderTemplateContext = {
    applicationSlug: application.slug,
    serverHost: server.agent.host ?? server.ssh.host,
  };

  const { composeYaml, env } = renderTemplate(template, answers, context);

  const parsed = parseComposeDocument(composeYaml);

  validateComposeSecurity(parsed);

  const conflict = await findHostPortConflict(
    String(application.serverId),
    publishedPortsOf(parsed),
    String(application._id),
  );

  if (conflict) {
    throw new Error(`Host port ${conflict.port} is already in use by ${conflict.owner}`);
  }

  const variables = parseEnvContent(env).map(({ key, value }) => ({
    key,
    value,
    secret: secretKeys.has(key),
  }));

  const inputKeys = new Set(template.inputs.map(input => input.key));
  const originInputs = Object.fromEntries(
    Object.entries(values).filter(([key]) => inputKeys.has(key)),
  );

  const registered = await findDatabasesOfApplication(String(application._id));
  const registeredServices = new Set(registered.map(database => database.link!.service));
  const templateServices = new Set(template.databases.map(database => database.service));

  const databasesToAdd = template.databases.filter(
    database => !registeredServices.has(database.service),
  );
  const servicesToRemove = [...registeredServices].filter(
    service => !templateServices.has(service),
  );

  try {
    if (databasesToAdd.length > 0) {
      await registerComposeDatabases(application, databasesToAdd);
    }

    await updateTemplateApplication(String(application._id), {
      compose: {
        content: composeYaml,
        expose: { service: template.expose.service, port: template.expose.port },
      },
      variables,
      origin: {
        templateId: template.id,
        templateVersion: template.version,
        inputs: originInputs,
        composeHash: composeHashOf(composeYaml),
      },
    });

    if (servicesToRemove.length > 0) {
      await unlinkComposeDatabasesOfServices(String(application._id), servicesToRemove);
    }
  } catch (error) {
    if (databasesToAdd.length > 0) {
      await unlinkComposeDatabasesOfServices(
        String(application._id),
        databasesToAdd.map(database => database.service),
      ).catch(() => {});
    }

    throw error instanceof Error ? error : new Error(String(error));
  }

  return { versionFellBackToDefault };
};

const resolveVersion = (template: Template, requested?: string): string | undefined => {
  if (!template.versions) {
    return undefined;
  }

  const value = requested ?? template.versions.default;

  if (!isVersionAllowed(template, value)) {
    throw new Error(versionPolicyMessage(template, value));
  }

  return value;
};

export const deployTemplateApplication = async (params: {
  template: Template;
  organizationId: string;
  projectId: string;
  server: Server;
  body: DeployTemplateDTO;
  triggeredBy: string;
}) => {
  const { template, organizationId, projectId, server, body, triggeredBy } = params;

  const secretKeys = new Set(template.secrets.map(secret => secret.key));

  for (const key of Object.keys(body.inputs)) {
    if (secretKeys.has(key)) {
      throw new Error(`"${key}" is generated by the server and cannot be provided as an input`);
    }

    if (template.versions?.key === key) {
      throw new Error(`"${key}" is the version selector and cannot be provided as an input`);
    }
  }

  const version = resolveVersion(template, body.version);

  if (version !== undefined) {
    await assertVersionExistsBestEffort(template, version);
  }

  const secretValues = Object.fromEntries(
    template.secrets.map(secret => [secret.key, generateSecretValue(secret.generate)]),
  );

  const versionAnswer =
    version !== undefined && template.versions ? { [template.versions.key]: version } : {};

  const slug = await uniqueSlug(body.environmentId, body.name);

  const context: RenderTemplateContext = {
    applicationSlug: slug,
    serverHost: server.agent.host ?? server.ssh.host,
  };

  const { composeYaml, env } = renderTemplate(
    template,
    { ...body.inputs, ...versionAnswer, ...secretValues },
    context,
  );

  const parsed = parseComposeDocument(composeYaml);
  const conflict = await findHostPortConflict(String(server._id), publishedPortsOf(parsed));

  if (conflict) {
    throw new Error(`Host port ${conflict.port} is already in use by ${conflict.owner}`);
  }

  const variables = parseEnvContent(env).map(({ key, value }) => ({
    key,
    value,
    secret: secretKeys.has(key),
  }));

  const applicationBody: CreateApplicationDTO = {
    source: 'compose',
    name: body.name,
    environmentId: body.environmentId,
    serverId: String(server._id),
    compose: {
      content: composeYaml,
      expose: { service: template.expose.service, port: template.expose.port },
    },
    variables,
    restartPolicy: 'unless-stopped',
  };

  let application: Application | undefined;

  try {
    application = await createApplication(organizationId, projectId, applicationBody, {
      slug,
      origin: {
        templateId: template.id,
        templateVersion: template.version,
        inputs: body.inputs,
        composeHash: composeHashOf(composeYaml),
      },
    });

    await registerComposeDatabases(application, template.databases);
    await ensureAutoDomain(application);

    const deployment = body.deployNow
      ? await enqueueDeployment({ application, trigger: 'manual', triggeredBy })
      : undefined;

    return { application, deployment };
  } catch (error) {
    if (!application) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    try {
      await removeApplication(String(application._id));
    } catch (cleanupError) {
      throw new Error(
        `Failed to deploy template "${template.id}" (${errorMessage(error)}), and cleaning up ` +
          `also failed: application ${application._id} was left behind (${errorMessage(cleanupError)})`,
      );
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
};
