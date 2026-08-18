import { generateUniqueSlug } from '../../utils';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import type { GitCredentials } from '../../providers/git';
import type { AuthPayload } from '../auth/auth.middleware';
import { unlinkDatabasesOfApplications } from '../databases/database.service';
import { removeDeploymentsOfApplications } from '../deployments/deployment.service';
import { composeContainerNameOf, containerNameOf } from '../deployments/naming';
import { removeDomainsOfApplications } from '../domains/domain.service';
import { issueInstallationToken } from '../git-sources/git-source.service';
import { findMembership } from '../organizations/membership.service';
import { isSuperuser } from '../users/user.service';
import { findTemplateById, templateStatusOf } from '../templates/template.service';
import { registerTopicAuthorizer } from '../websocket/websocket.service';
import applicationModel from './application.model';
import type { CreateApplicationDTO, UpdateApplicationDTO } from './application.schema';
import { callbackUrlOf } from './webhook.service';

export const uniqueSlug = (environmentId: string, name: string) =>
  generateUniqueSlug(name, 'application', async slug =>
    Boolean(await applicationModel.exists({ environmentId, slug })),
  );

const encryptVariables = (variables: CreateApplicationDTO['variables']) =>
  variables.map(variable => ({
    key: variable.key,
    value: encryptSecret(variable.value),
    secret: variable.secret,
  }));

export const decryptVariables = (variables: ApplicationVariable[]) =>
  variables.map(variable => ({
    key: variable.key,
    value: decryptSecret(variable.value),
    secret: variable.secret,
  }));

export const VERSION_VARIABLE_PROJECTION = '+variables.value';

export const findApplication = (organizationId: string, applicationId: string) =>
  applicationModel
    .findOne({ _id: applicationId, organizationId })
    .select(VERSION_VARIABLE_PROJECTION);

export const findApplicationNames = (applicationIds: string[]) =>
  applicationModel.find({ _id: { $in: applicationIds } }).select('name');

export const findApplicationWithSecrets = (organizationId: string, applicationId: string) =>
  applicationModel
    .findOne({ _id: applicationId, organizationId })
    .select('+variables.value +git.token');

export const createApplication = async (
  organizationId: string,
  projectId: string,
  body: CreateApplicationDTO,
  options?: {
    slug?: string;
    origin?: ApplicationOrigin;
    portMappings?: ApplicationPortMapping[];
    volumes?: ApplicationVolume[];
    autoDomainDisabled?: boolean;
  },
) => {
  const base = {
    organizationId,
    projectId,
    environmentId: body.environmentId,
    serverId: body.serverId,
    name: body.name,
    slug: options?.slug ?? (await uniqueSlug(body.environmentId, body.name)),
    status: 'created' as const,
    source: body.source,
    variables: encryptVariables(body.variables),
    restartPolicy: body.restartPolicy,
    ...(options?.origin ? { origin: options.origin } : {}),
    ...(options?.autoDomainDisabled === undefined
      ? {}
      : { autoDomainDisabled: options.autoDomainDisabled }),
  };

  if (body.source === 'compose') {
    return applicationModel.create({
      ...base,
      compose: body.compose,
      resources: body.resources,
      portMappings: options?.portMappings ?? [],
      volumes: options?.volumes ?? [],
    });
  }

  return applicationModel.create({
    ...base,
    git: {
      ...body.git,
      token: body.git.token ? encryptSecret(body.git.token) : undefined,
      hasToken: Boolean(body.git.token),
    },
    port: body.port,
    portMappings: body.portMappings,
    volumes: body.volumes,
    networks: body.networks,
    healthcheck: body.healthcheck,
    resources: body.resources,
  });
};

export const exposedPortOf = (application: Application): number => {
  const port =
    application.source === 'compose' ? application.compose?.expose.port : application.port;

  if (!port) {
    throw new Error(`Application ${application._id} has no exposed port configured`);
  }

  return port;
};

export const upstreamHostOf = (application: Application): string =>
  application.source === 'compose' && application.compose
    ? composeContainerNameOf(application.slug, application.compose.expose.service)
    : containerNameOf(application.slug);

export const replaceVariables = (
  applicationId: string,
  variables: CreateApplicationDTO['variables'],
) =>
  applicationModel.updateOne(
    { _id: applicationId },
    { $set: { variables: encryptVariables(variables) } },
  );

export const updateVariableValue = (applicationId: string, key: string, value: string) =>
  applicationModel.updateOne(
    { _id: applicationId, 'variables.key': key },
    { $set: { 'variables.$.value': encryptSecret(value) } },
  );

export const updateTemplateApplication = (
  applicationId: string,
  changes: {
    compose: ApplicationCompose;
    variables: CreateApplicationDTO['variables'];
    portMappings: ApplicationPortMapping[];
    volumes: ApplicationVolume[];
    origin: ApplicationOrigin;
  },
) =>
  applicationModel.updateOne(
    { _id: applicationId },
    {
      $set: {
        'compose.content': changes.compose.content,
        'compose.expose': changes.compose.expose,
        variables: encryptVariables(changes.variables),
        portMappings: changes.portMappings,
        volumes: changes.volumes,
        origin: changes.origin,
      },
    },
  );

export const updateApplication = async (
  application: Application,
  changes: UpdateApplicationDTO,
) => {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};

  if (changes.name !== undefined) {
    set.name = changes.name;
    set.slug = await uniqueSlug(String(application.environmentId), changes.name);
  }

  for (const field of [
    'serverId',
    'port',
    'portMappings',
    'volumes',
    'networks',
    'resources',
    'restartPolicy',
  ] as const) {
    if (changes[field] !== undefined) {
      set[field] = changes[field];
    }
  }

  for (const [field, value] of Object.entries(changes.git ?? {})) {
    if (value === undefined) {
      continue;
    }

    if (field === 'token') {
      if (value === null) {
        unset['git.token'] = '';
        set['git.hasToken'] = false;
      } else {
        set['git.token'] = encryptSecret(String(value));
        set['git.hasToken'] = true;
      }
    } else {
      set[`git.${field}`] = value;
    }
  }

  for (const [field, value] of Object.entries(changes.compose ?? {})) {
    if (value !== undefined) {
      set[`compose.${field}`] = value;
    }
  }

  if (changes.healthcheck === null) {
    unset.healthcheck = '';
  } else if (changes.healthcheck !== undefined) {
    set.healthcheck = changes.healthcheck;
  }

  await applicationModel.updateOne(
    { _id: application._id },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );

  return applicationModel.findById(application._id).select(VERSION_VARIABLE_PROJECTION);
};

const removeApplicationsWhere = async (filter: Record<string, unknown>) => {
  const applications = await applicationModel.find(filter).select('_id');

  if (!applications.length) {
    return;
  }

  const applicationIds = applications.map(application => String(application._id));

  await removeDomainsOfApplications(applicationIds);
  await removeDeploymentsOfApplications(applicationIds);
  await unlinkDatabasesOfApplications(applicationIds);
  await applicationModel.deleteMany(filter);
};

export const removeApplication = (applicationId: string) =>
  removeApplicationsWhere({ _id: applicationId });

export const removeApplicationsOfEnvironment = (environmentId: string) =>
  removeApplicationsWhere({ environmentId });

export const removeApplicationsOfProject = (projectId: string) =>
  removeApplicationsWhere({ projectId });

export const countApplicationsOfServer = (serverId: string) =>
  applicationModel.countDocuments({ serverId });

export const disableAutoDomain = (applicationId: string) =>
  applicationModel.updateOne({ _id: applicationId }, { $set: { autoDomainDisabled: true } });

export const countApplicationsOfGitSource = (gitSourceId: string) =>
  applicationModel.countDocuments({ 'git.gitSourceId': gitSourceId });

export const resolveGitCredentials = async (application: Application): Promise<GitCredentials> => {
  if (application.git.source === 'github-app') {
    return {
      host: application.git.host,
      token: await issueInstallationToken(
        String(application.git.gitSourceId),
        String(application.git.installationId),
      ),
    };
  }

  return {
    host: application.git.host,
    token: application.git.token ? decryptSecret(application.git.token) : '',
  };
};

const authorizeApplicationTopic = async (auth: AuthPayload, applicationId: string) => {
  const application = await applicationModel.findById(applicationId);

  if (!application) {
    return false;
  }

  if (isSuperuser(auth.email)) {
    return true;
  }

  return Boolean(await findMembership(String(application.organizationId), auth.sub));
};

registerTopicAuthorizer('application', authorizeApplicationTopic);

export const listApplicationsOfOrganization = (organizationId: string) =>
  applicationModel
    .find({ organizationId })
    .select(VERSION_VARIABLE_PROJECTION)
    .sort({ createdAt: 1 });

const currentVersionOf = (application: Application) => {
  if (application.source !== 'compose' || !application.origin?.templateId) {
    return undefined;
  }

  const template = findTemplateById(application.origin.templateId);

  if (!template?.versions) {
    return undefined;
  }

  const variable = application.variables.find(
    candidate => candidate.key === template.versions!.key,
  );

  if (!variable?.value) {
    return undefined;
  }

  return { key: template.versions.key, current: decryptSecret(variable.value) };
};

export const serializeApplication = (application: Application) => ({
  id: String(application._id),
  organizationId: String(application.organizationId),
  projectId: String(application.projectId),
  environmentId: String(application.environmentId),
  serverId: String(application.serverId),
  name: application.name,
  slug: application.slug,
  status: application.status,
  source: application.source,
  git:
    application.source === 'git'
      ? {
          host: application.git.host,
          repository: application.git.repository,
          branch: application.git.branch,
          dockerfilePath: application.git.dockerfilePath,
          buildContext: application.git.buildContext,
          autoDeploy: application.git.autoDeploy,
          hasToken: application.git.hasToken,
          hasWebhook: Boolean(application.git.webhookId),
          webhookUrl: application.git.webhookId
            ? callbackUrlOf(String(application._id))
            : undefined,
          source: application.git.source,
          gitSourceId: application.git.gitSourceId
            ? String(application.git.gitSourceId)
            : undefined,
          installationId: application.git.installationId,
        }
      : undefined,
  compose:
    application.source === 'compose' && application.compose
      ? { content: application.compose.content, expose: application.compose.expose }
      : undefined,
  port: application.source === 'git' ? application.port : application.compose?.expose.port,
  portMappings: application.portMappings,
  variables: application.variables.map(variable => ({
    key: variable.key,
    secret: variable.secret,
  })),
  volumes: application.volumes,
  networks: application.source === 'git' ? application.networks : undefined,
  healthcheck:
    application.source === 'git' && application.healthcheck?.path
      ? application.healthcheck
      : undefined,
  resources: application.resources,
  restartPolicy: application.restartPolicy,
  origin: application.origin,
  version: currentVersionOf(application),
  templateStatus: templateStatusOf(application),
  lastError: application.lastError,
  autoDomainDisabled: application.autoDomainDisabled,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
});
