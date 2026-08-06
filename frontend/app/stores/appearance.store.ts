import { defineStore } from 'pinia';

export type AppearanceMode = 'light' | 'dark' | 'system';

interface IAppearanceStore {
  mode: AppearanceMode;
}

export const useAppearanceStore = defineStore('appearance', {
  state: (): IAppearanceStore => ({
    mode: 'system',
  }),
  actions: {
    setMode(mode: AppearanceMode) {
      this.mode = mode;
    },
  },
  persist: {
    key: 'zydock:appearance',
  },
});
