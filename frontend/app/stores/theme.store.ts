import { defineStore } from 'pinia';

export interface IThemeBranding {
  logo?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

interface IThemeStore {
  /** Name shown in the sidebar and in the tab title — the organization's, or the platform's. */
  name: string;
  logo: string;
  favicon: string;
  primaryColor: string;
  secondaryColor: string;
}

/**
 * Platform defaults: what the interface shows before any organization branding is applied, and what
 * it falls back to whenever an organization leaves a field empty.
 */
export const THEME_DEFAULTS: IThemeStore = {
  name: 'Zydock',
  logo: '',
  favicon: '/favicon.svg',
  primaryColor: '#3b82f6',
  secondaryColor: '#22c55e',
};

export const useThemeStore = defineStore('theme', {
  state: (): IThemeStore => ({ ...THEME_DEFAULTS }),
  actions: {
    /**
     * Only non-empty fields override the defaults, so a half-filled branding never blanks a color
     * nor empties the name. Applied at render time from the organization the session is looking at.
     */
    apply(name: string | undefined, branding: IThemeBranding | undefined) {
      this.name = name?.trim() || THEME_DEFAULTS.name;
      this.logo = branding?.logo?.trim() || THEME_DEFAULTS.logo;
      this.favicon = branding?.favicon?.trim() || THEME_DEFAULTS.favicon;
      this.primaryColor = branding?.primaryColor?.trim() || THEME_DEFAULTS.primaryColor;
      this.secondaryColor = branding?.secondaryColor?.trim() || THEME_DEFAULTS.secondaryColor;
    },
    reset() {
      this.$patch({ ...THEME_DEFAULTS });
    },
  },
  // Not persisted: the theme is resolved from the organization at render time (SSR included), so a
  // stored value could outlive the branding it came from and mismatch the server-rendered markup.
  persist: false,
});
