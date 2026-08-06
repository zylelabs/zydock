import { defineStore } from 'pinia';
import type { ApplicationStatus } from '~/composables/services/useApplications';

export interface IRecentApplication {
  id: string;
  name: string;
  status: ApplicationStatus;
}

interface IRecentApplicationsStore {
  items: IRecentApplication[];
}

const MAX_RECENT = 5;

export const useRecentApplicationsStore = defineStore('recentApplications', {
  state: (): IRecentApplicationsStore => ({ items: [] }),
  actions: {
    push(application: IRecentApplication) {
      const rest = this.items.filter(item => item.id !== application.id);

      this.items = [application, ...rest].slice(0, MAX_RECENT);
    },
    clear() {
      this.$reset();
    },
  },
  persist: {
    key: 'zydock:recent-applications',
  },
});
