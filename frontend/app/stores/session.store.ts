import { defineStore } from 'pinia';

export interface ISessionUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  superuser?: boolean;
}

export interface ISessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface ISessionStore extends ISessionTokens {
  user: ISessionUser | null;
  organizationId: string;
}

export const useSessionStore = defineStore('session', {
  state: (): ISessionStore => ({
    accessToken: '',
    refreshToken: '',
    user: null,
    organizationId: '',
  }),
  actions: {
    start(tokens: ISessionTokens, user: ISessionUser) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.user = user;
    },
    renew(tokens: ISessionTokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
    },
    selectOrganization(organizationId: string) {
      this.organizationId = organizationId;
    },
    updateUser(patch: Partial<ISessionUser>) {
      if (this.user) {
        Object.assign(this.user, patch);
      }
    },
    clear() {
      this.$reset();
    },
  },
  getters: {
    isAuthenticated: state => Boolean(state.accessToken),
  },
  persist: true,
});
