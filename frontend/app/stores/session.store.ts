import { defineStore } from 'pinia';

export interface ISessionUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface ISessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface ISessionStore extends ISessionTokens {
  user: ISessionUser | null;
  /** Organization the interface is currently looking at; every resource route hangs from it. */
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
    // The backend rotates the refresh token on every use, so both tokens are always replaced.
    renew(tokens: ISessionTokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
    },
    selectOrganization(organizationId: string) {
      this.organizationId = organizationId;
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
