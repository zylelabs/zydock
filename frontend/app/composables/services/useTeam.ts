import type { Paginated } from '../useApi';
import type { OrganizationRole } from '~/stores/organization.store';

export interface Member {
  userId: string;
  role: OrganizationRole;
  email?: string;
  name?: string;
  avatar?: string;
  joinedAt: string;
}

export type InvitableRole = 'admin' | 'member';

export interface Invite {
  id: string;
  email: string;
  role: InvitableRole;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

export const useTeam = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}`;

  const listMembers = () =>
    api.get<Paginated<Member>>(`${base()}/members`, { query: { size: 100 } });

  const updateMemberRole = (userId: string, role: OrganizationRole) =>
    api.patch<{ member: Member }>(`${base()}/members/${userId}`, { body: { role } });

  const removeMember = (userId: string) =>
    api.del<{ message: string }>(`${base()}/members/${userId}`);

  const leave = () => api.del<{ message: string }>(`${base()}/members/me`);

  const listInvites = () =>
    api.get<Paginated<Invite>>(`${base()}/invites`, { query: { size: 100 } });

  const createInvite = (email: string, role: InvitableRole) =>
    api.post<{ invite: Invite }>(`${base()}/invites`, { body: { email, role } });

  const revokeInvite = (inviteId: string) =>
    api.del<{ message: string }>(`${base()}/invites/${inviteId}`);

  return {
    listMembers,
    updateMemberRole,
    removeMember,
    leave,
    listInvites,
    createInvite,
    revokeInvite,
  };
};
