import { dispatchNotification } from '../../providers/notification';
import { resolvePublicUrl } from '../dashboard/dashboard.service';
import { generateToken, hashToken } from '../auth/session.service';
import inviteModel from './invite.model';
import { type OrganizationRole } from './membership.schema';

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;

type CreateInviteParams = {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
};

export const createInvite = async (params: CreateInviteParams) => {
  const token = generateToken(INVITE_TOKEN_BYTES);

  await inviteModel.updateMany(
    {
      organizationId: params.organizationId,
      email: params.email,
      acceptedAt: null,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );

  const invite = await inviteModel.create({
    organizationId: params.organizationId,
    email: params.email,
    role: params.role,
    tokenHash: await hashToken(token),
    invitedBy: params.invitedBy,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  return { invite, token };
};

export const findActiveInviteByToken = async (organizationId: string, token: string) =>
  inviteModel
    .findOne({
      organizationId,
      tokenHash: await hashToken(token),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
    .select('+tokenHash');

export const acceptInvite = (id: string) =>
  inviteModel.updateOne({ _id: id, acceptedAt: null }, { $set: { acceptedAt: new Date() } });

export const revokeInvite = async (organizationId: string, inviteId: string) => {
  const result = await inviteModel.updateOne(
    { _id: inviteId, organizationId, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  return result.matchedCount > 0;
};

export const sendInviteEmail = async (
  invite: Invite,
  organization: Organization,
  token: string,
) => {
  const link = `${await resolvePublicUrl()}/invites/accept?organization=${String(invite.organizationId)}&token=${token}`;

  return dispatchNotification(
    {
      subject: `You were invited to ${organization.name}`,
      body: `You were invited to join ${organization.name} as ${invite.role}. The link below expires in ${INVITE_TTL_DAYS} days.\n\n${link}`,
      severity: 'info',
      metadata: { organizationId: String(invite.organizationId) },
    },
    [{ channel: 'email', address: invite.email }],
  );
};

export const serializeInvite = (invite: Invite) => ({
  id: String(invite._id),
  email: invite.email,
  role: invite.role,
  invitedBy: String(invite.invitedBy),
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
});
