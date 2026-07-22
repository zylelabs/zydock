import { generateUniqueSlug } from '../../utils';
import { removeApplicationsOfEnvironment } from '../applications/application.service';
import environmentModel from './environment.model';

const uniqueSlug = (projectId: string, name: string) =>
  generateUniqueSlug(name, 'environment', async slug =>
    Boolean(await environmentModel.exists({ projectId, slug })),
  );

export const createEnvironment = async (organizationId: string, projectId: string, name: string) =>
  environmentModel.create({
    organizationId,
    projectId,
    name,
    slug: await uniqueSlug(projectId, name),
  });

export const findEnvironment = (projectId: string, environmentId: string) =>
  environmentModel.findOne({ _id: environmentId, projectId });

/** Used by applications, which reach an environment through the organization, not the project. */
export const findEnvironmentOfOrganization = (organizationId: string, environmentId: string) =>
  environmentModel.findOne({ _id: environmentId, organizationId });

export const renameEnvironment = async (environment: Environment, name: string) => {
  await environmentModel.updateOne(
    { _id: environment._id },
    { $set: { name, slug: await uniqueSlug(String(environment.projectId), name) } },
  );

  return environmentModel.findById(environment._id);
};

export const deleteEnvironment = async (environmentId: string) => {
  await removeApplicationsOfEnvironment(environmentId);
  await environmentModel.deleteOne({ _id: environmentId });
};

export const removeEnvironmentsOfProject = (projectId: string) =>
  environmentModel.deleteMany({ projectId });

export const countEnvironmentsOfProject = (projectId: string) =>
  environmentModel.countDocuments({ projectId });

export const serializeEnvironment = (environment: Environment) => ({
  id: String(environment._id),
  projectId: String(environment.projectId),
  name: environment.name,
  slug: environment.slug,
  createdAt: environment.createdAt,
});
