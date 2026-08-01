import { defineStore } from 'pinia';

interface IUserStore {
  email: string;
  name: string;
}

export const useUserStore = defineStore('user', {
  state: (): IUserStore => ({
    email: '',
    name: '',
  }),
});
