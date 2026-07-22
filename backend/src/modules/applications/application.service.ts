import { generateUniqueSlug } from '../../utils';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import type { AuthPayload } from '../auth/auth.middleware';
import { removeDeploymentsOfApplications } from '../deployments/deployment.service';
import { findMembership } from '../organizations/membership.service';
import { isSuperuser } from '../users/user.service';
import { registerTopicAuthorizer } from '../websocket/websocket.service';
import applicationModel from './application.model';
import type { CreateApplicationDTO, UpdateApplicationDTO } from './application.schema';

const uniqueSlug = (environmentId: string, name: string) =>
  generateUniqueSlug(name, 'application', async slug =>
    Boolean(await applicationModel.exists({ environmentId, slug })),
  );

/** Variable values and the git token are encrypted: the platform has to use them, not compare them. */
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

export const findApplication = (organizationId: string, applicationId: string) =>
  applicationModel.findOne({ _id: applicationId, organizationId });

/** Only for the deploy path and the variables endpoint — everything else must not see the values. */
export const findApplicationWithSecrets = (organizationId: string, applicationId: string) =>
  applicationModel
    .findOne({ _id: applicationId, organizationId })
    .select('+variables.value +git.token');

export const createApplication = async (
  organizationId: string,
  projectId: string,
  body: CreateApplicationDTO,
) =>
  applicationModel.create({
    organizationId,
    projectId,
    environmentId: body.environmentId,
    serverId: body.serverId,
    name: body.name,
    slug: await uniqueSlug(body.environmentId, body.name),
    status: 'created',
    git: {
      ...body.git,
      token: body.git.token ? encryptSecret(body.git.token) : undefined,
      hasToken: Boolean(body.git.token),
    },
    port: body.port,
    variables: encryptVariables(body.variables),
    volumes: body.volumes,
    networks: body.networks,
    healthcheck: body.healthcheck,
    resources: body.resources,
    restartPolicy: body.restartPolicy,
  });

export const replaceVariables = (
  applicationId: string,
  variables: CreateApplicationDTO['variables'],
) =>
  applicationModel.updateOne(
    { _id: applicationId },
    { $set: { variables: encryptVariables(variables) } },
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
    'volumes',
    'networks',
    'resources',
    'restartPolicy',
  ] as const) {
    if (changes[field] !== undefined) {
      set[field] = changes[field];
    }
  }

  // Dotted paths, one per informed field: replacing the whole `git` object would drop the token,
  // which is `select: false` and therefore absent from the document in hand.
  for (const [field, value] of Object.entries(changes.git ?? {})) {
    if (value === undefined) {
      continue;
    }

    if (field === 'token') {
      set['git.token'] = encryptSecret(String(value));
      set['git.hasToken'] = true;
    } else {
      set[`git.${field}`] = value;
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

  return applicationModel.findById(application._id);
};

/** Applications never disappear alone: their deployment history goes with them. */
const removeApplicationsWhere = async (filter: Record<string, unknown>) => {
  const applications = await applicationModel.find(filter).select('_id');

  if (!applications.length) {
    return;
  }

  await removeDeploymentsOfApplications(applications.map(application => String(application._id)));
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

export const serializeApplication = (application: Application) => ({
  id: String(application._id),
  organizationId: String(application.organizationId),
  projectId: String(application.projectId),
  environmentId: String(application.environmentId),
  serverId: String(application.serverId),
  name: application.name,
  slug: application.slug,
  status: application.status,
  git: {
    host: application.git.host,
    repository: application.git.repository,
    branch: application.git.branch,
    dockerfilePath: application.git.dockerfilePath,
    buildContext: application.git.buildContext,
    autoDeploy: application.git.autoDeploy,
    /** Never the token itself — only whether the application carries one. */
    hasToken: application.git.hasToken,
  },
  port: application.port,
  // Values stay out: `variables.value` is `select: false` and never leaves through here.
  variables: application.variables.map(variable => ({
    key: variable.key,
    secret: variable.secret,
  })),
  volumes: application.volumes,
  networks: application.networks,
  healthcheck: application.healthcheck?.path ? application.healthcheck : undefined,
  resources: application.resources,
  restartPolicy: application.restartPolicy,
  lastError: application.lastError,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
});
