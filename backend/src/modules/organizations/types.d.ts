interface OrganizationBranding {
  logo?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

interface OrganizationData {
  name: string;
  slug: string;
  branding: OrganizationBranding;
}

type Organization = BaseDocument<OrganizationData>;

interface MembershipData {
  organizationId: string;
  userId: string;
  role: import('./membership.schema').OrganizationRole;
}

type Membership = BaseDocument<MembershipData>;

interface InviteData {
  organizationId: string;
  email: string;
  role: import('./membership.schema').OrganizationRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}

type Invite = BaseDocument<InviteData>;
