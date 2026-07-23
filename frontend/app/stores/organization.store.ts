import { defineStore } from 'pinia';

export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface OrganizationBranding {
  logo?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: OrganizationRole;
  branding: OrganizationBranding;
  createdAt: string;
}

interface IOrganizationStore {
  organizations: Organization[];
  loaded: boolean;
}

/**
 * The organizations the signed-in user belongs to. The *selected* one lives in the session store
 * (`organizationId`); this store holds the list itself, loaded from the API on entering the app.
 */
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
    clear() {
      this.$reset();
    },
  },
  // Loaded from the API each time the app opens, so nothing to persist.
  persist: false,
});
