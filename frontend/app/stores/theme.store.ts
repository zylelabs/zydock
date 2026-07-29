import { defineStore } from 'pinia';

export interface IThemeBranding {
  logo?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

interface IThemeStore {
  name: string;
  logo: string;
  favicon: string;
  primaryColor: string;
  secondaryColor: string;
}

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
  persist: false,
});
