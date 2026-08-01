import { defineStore } from 'pinia';

interface IPageStore {
  loadingPage: string[];
  name?: string;
  data: { [name: string]: any };
}

export const usePageStore = defineStore('page', {
  state: (): IPageStore => ({
    loadingPage: [],
    name: '',
    data: {},
  }),
  actions: {
    addPageData(obj: { [name: string]: unknown }) {
      if (typeof this.data !== 'object' || this.data === null) {
        this.data = {};
      }

      this.data = {
        ...(this.data as Record<string, unknown>),
        ...obj,
      };
    },
    addLoadingPage(loadingKey: string) {
      if (!this.loadingPage.find(item => item === loadingKey)) {
        this.loadingPage.push(loadingKey);
      }
    },
    removeLoadingPage(loadingKey: string) {
      this.loadingPage = this.loadingPage.filter(item => item !== loadingKey);
    },
    clearLoadingPage() {
      this.loadingPage = [];
    },
  },
  getters: {
    hasLoadingPage: state => state.loadingPage.length > 0,
  },
  persist: false,
});
