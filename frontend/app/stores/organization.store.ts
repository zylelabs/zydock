import { defineStore } from 'pinia';

export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: OrganizationRole;
  createdAt: string;
}

interface IOrganizationStore {
  organizations: Organization[];
  loaded: boolean;
}

export const useOrganizationStore = defineStore('organization', {
  state: (): IOrganizationStore => ({
    organizations: [],
    loaded: false,
  }),
  actions: {
    set(organizations: Organization[]) {
      this.organizations = organizations;
      this.loaded = true;
    },
    upsert(organization: Organization) {
      const index = this.organizations.findIndex(item => item.id === organization.id);

      if (index >= 0) {
        this.organizations[index] = organization;
      } else {
        this.organizations.unshift(organization);
      }
    },
    remove(organizationId: string) {
      this.organizations = this.organizations.filter(
        organization => organization.id !== organizationId,
      );
    },
    clear() {
      this.$reset();
    },
  },
});
