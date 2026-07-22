import membershipModel from './membership.model';
import { type OrganizationRole, ROLE_RANK } from './membership.schema';

export const findMembership = (organizationId: string, userId: string) =>
  membershipModel.findOne({ organizationId, userId });

export const createMembership = (organizationId: string, userId: string, role: OrganizationRole) =>
  membershipModel.create({ organizationId, userId, role });

export const countOwners = (organizationId: string) =>
  membershipModel.countDocuments({ organizationId, role: 'owner' });

export const removeMembership = (organizationId: string, userId: string) =>
  membershipModel.deleteOne({ organizationId, userId });

export const removeAllMemberships = (organizationId: string) =>
  membershipModel.deleteMany({ organizationId });

export const hasRole = (role: OrganizationRole, minimumRole: OrganizationRole) =>
  ROLE_RANK[role] >= ROLE_RANK[minimumRole];

export const serializeMembership = (membership: Membership, user?: User | null) => ({
  userId: String(membership.userId),
  role: membership.role,
  email: user?.email,
  name: user?.name,
  avatar: user?.avatar,
  joinedAt: membership.createdAt,
});
