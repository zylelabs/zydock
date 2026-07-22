import { slugify } from '../../utils';
import inviteModel from './invite.model';
import { type OrganizationRole } from './membership.schema';
import { removeServersOfOrganization } from '../servers/server.service';
import { createMembership, removeAllMemberships } from './membership.service';
import organizationModel from './organization.model';

const SLUG_SUFFIX_BYTES = 3;

const generateUniqueSlug = async (name: string) => {
  const base = slugify(name) || 'organization';

  if (!(await organizationModel.exists({ slug: base }))) {
    return base;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const buffer = new Uint8Array(SLUG_SUFFIX_BYTES);

    crypto.getRandomValues(buffer);

    const candidate = `${base}-${Buffer.from(buffer).toString('hex')}`;

    if (!(await organizationModel.exists({ slug: candidate }))) {
      return candidate;
    }
  }

  throw new Error('Could not generate a unique slug for the organization');
};

export const findOrganizationById = (id: string) => organizationModel.findById(id);

export const createOrganization = async (
  name: string,
  ownerId: string,
  branding?: OrganizationBranding,
) => {
  const organization = await organizationModel.create({
    name,
    slug: await generateUniqueSlug(name),
    branding: branding ?? {},
  });

  await createMembership(String(organization._id), ownerId, 'owner');

  return organization;
};

export const deleteOrganization = async (organizationId: string) => {
  await removeServersOfOrganization(organizationId);
  await removeAllMemberships(organizationId);
  await inviteModel.deleteMany({ organizationId });
  await organizationModel.deleteOne({ _id: organizationId });
};

export const serializeOrganization = (organization: Organization, role?: OrganizationRole) => ({
  id: String(organization._id),
  name: organization.name,
  slug: organization.slug,
  role,
  branding: {
    logo: organization.branding?.logo,
    favicon: organization.branding?.favicon,
    primaryColor: organization.branding?.primaryColor,
    secondaryColor: organization.branding?.secondaryColor,
  },
  createdAt: organization.createdAt,
});
