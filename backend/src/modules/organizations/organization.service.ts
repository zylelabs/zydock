import { generateUniqueSlug } from '../../utils';
import inviteModel from './invite.model';
import { type OrganizationRole } from './membership.schema';
import { removeBackupsOfOrganization } from '../backups/backup.service';
import { removeNotificationsOfOrganization } from '../notifications/notification.service';
import { removeProjectsOfOrganization } from '../projects/project.service';
import { removeServersOfOrganization } from '../servers/server.service';
import { createMembership, removeAllMemberships } from './membership.service';
import organizationModel from './organization.model';

const uniqueSlug = (name: string) =>
  generateUniqueSlug(name, 'organization', async slug =>
    Boolean(await organizationModel.exists({ slug })),
  );

export const findOrganizationById = (id: string) => organizationModel.findById(id);

export const createOrganization = async (name: string, ownerId: string) => {
  const organization = await organizationModel.create({
    name,
    slug: await uniqueSlug(name),
  });

  await createMembership(String(organization._id), ownerId, 'owner');

  return organization;
};

export const deleteOrganization = async (organizationId: string) => {
  await removeProjectsOfOrganization(organizationId);
  await removeServersOfOrganization(organizationId);
  await removeBackupsOfOrganization(organizationId);
  await removeNotificationsOfOrganization(organizationId);
  await removeAllMemberships(organizationId);
  await inviteModel.deleteMany({ organizationId });
  await organizationModel.deleteOne({ _id: organizationId });
};

export const serializeOrganization = (organization: Organization, role?: OrganizationRole) => ({
  id: String(organization._id),
  name: organization.name,
  slug: organization.slug,
  role,
  createdAt: organization.createdAt,
});
