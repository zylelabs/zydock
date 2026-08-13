import { defineStore } from 'pinia';
import type { ApplicationStatus } from '~/composables/services/useApplications';

export interface IRecentApplication {
  id: string;
  name: string;
  status: ApplicationStatus;
}

interface IRecentApplicationsStore {
  items: Record<string, IRecentApplication[]>;
}

const MAX_RECENT = 5;

export const useRecentApplicationsStore = defineStore('recentApplications', {
  state: (): IRecentApplicationsStore => ({
    items: {},
  }),
  actions: {
    push(organizationId: string, application: IRecentApplication) {
      const rest = (this.items[organizationId] ?? []).filter(item => item.id !== application.id);

      this.items = {
        ...this.items,
        [organizationId]: [application, ...rest].slice(0, MAX_RECENT),
      };
    },
    sync(organizationId: string, application: IRecentApplication) {
      const list = this.items[organizationId];

      if (!list || !list.some(item => item.id === application.id)) {
        return;
      }

      this.items = {
        ...this.items,
        [organizationId]: list.map(item =>
          item.id === application.id
            ? { ...item, name: application.name, status: application.status }
            : item,
        ),
      };
    },
    remove(organizationId: string, applicationId: string) {
      const list = this.items[organizationId];

      if (!list) {
        return;
      }

      this.items = {
        ...this.items,
        [organizationId]: list.filter(item => item.id !== applicationId),
      };
    },
    clear() {
      this.$reset();
    },
  },
  getters: {
    forOrganization:
      state =>
      (organizationId: string): IRecentApplication[] =>
        state.items[organizationId] ?? [],
    current(): IRecentApplication[] {
      return this.forOrganization(useSessionStore().organizationId);
    },
  },
  persist: {
    key: 'zydock:recent-applications',
    afterHydrate: context => {
      const store = context.store as unknown as IRecentApplicationsStore;

      if (Array.isArray(store.items)) {
        store.items = {};
      }
    },
  },
});
