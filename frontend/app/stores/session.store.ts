import { defineStore } from 'pinia';

export interface ISessionUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  /** Platform-wide capability (not an organization role) — gates the queue admin screen. */
  superuser?: boolean;
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
    // The account page edits name/avatar without a fresh sign-in — patches the cached profile in place.
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
