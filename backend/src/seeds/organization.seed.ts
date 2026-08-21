import config from '../config';
import { createMembership } from '../modules/organizations/membership.service';
import organizationModel from '../modules/organizations/organization.model';
import { createOrganization } from '../modules/organizations/organization.service';
import userModel from '../modules/users/user.model';
import { logInfo, logWarn } from '../utils/logger';

const DEFAULT_ORGANIZATION_SLUG = 'my-organization';

export const seedDefaultOrganization = async () => {
  if (await organizationModel.findOne({ slug: DEFAULT_ORGANIZATION_SLUG })) {
    logInfo('Default organization already exists');
    return;
  }

  const owners = await userModel.find({ superuser: true });

  if (!owners.length) {
    logWarn('No superuser accounts found yet, skipping default organization');
    return;
  }

  const [firstOwner, ...otherOwners] = owners;

  const organization = await createOrganization(
    config.defaultOrganization.name,
    String(firstOwner._id),
  );

  for (const owner of otherOwners) {
    await createMembership(String(organization._id), String(owner._id), 'owner');
  }

  logInfo(`Default organization created: ${organization.name}`, { slug: organization.slug });
};
