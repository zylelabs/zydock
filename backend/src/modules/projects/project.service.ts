import { generateUniqueSlug } from '../../utils';
import { removeApplicationsOfProject } from '../applications/application.service';
import { DEFAULT_ENVIRONMENT_NAME } from './environment.schema';
import { createEnvironment, removeEnvironmentsOfProject } from './environment.service';
import projectModel from './project.model';

const uniqueSlug = (organizationId: string, name: string) =>
  generateUniqueSlug(name, 'project', async slug =>
    Boolean(await projectModel.exists({ organizationId, slug })),
  );

export const findProject = (organizationId: string, projectId: string) =>
  projectModel.findOne({ _id: projectId, organizationId });

export const createProject = async (organizationId: string, name: string, description?: string) => {
  const project = await projectModel.create({
    organizationId,
    name,
    slug: await uniqueSlug(organizationId, name),
    description,
  });

  await createEnvironment(organizationId, String(project._id), DEFAULT_ENVIRONMENT_NAME);

  return project;
};

export const updateProject = async (
  project: Project,
  changes: { name?: string; description?: string },
) => {
  const update: Record<string, unknown> = {};

  if (changes.name !== undefined) {
    update.name = changes.name;
    update.slug = await uniqueSlug(String(project.organizationId), changes.name);
  }

  if (changes.description !== undefined) {
    update.description = changes.description;
  }

  await projectModel.updateOne({ _id: project._id }, { $set: update });

  return projectModel.findById(project._id);
};

export const deleteProject = async (projectId: string) => {
  await removeApplicationsOfProject(projectId);
  await removeEnvironmentsOfProject(projectId);
  await projectModel.deleteOne({ _id: projectId });
};

export const removeProjectsOfOrganization = async (organizationId: string) => {
  const projects = await projectModel.find({ organizationId }).select('_id');

  for (const project of projects) {
    await deleteProject(String(project._id));
  }
};

export const listProjectsOfOrganization = (organizationId: string) =>
  projectModel.find({ organizationId }).sort({ createdAt: 1 });

export const serializeProject = (project: Project) => ({
  id: String(project._id),
  organizationId: String(project.organizationId),
  name: project.name,
  slug: project.slug,
  description: project.description,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
