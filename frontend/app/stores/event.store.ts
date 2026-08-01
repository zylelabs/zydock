import { defineStore } from 'pinia';

interface IEventStore {
  message: string;
  args: unknown;
  count: number;
}

export const useEventStore = defineStore('event', {
  state: (): IEventStore => ({
    message: '',
    args: {},
    count: 0,
  }),
  actions: {
    send(message: string, args?: unknown) {
      this.message = message;
      this.args = args;
      this.count++;
    },
  },
  getters: {
    getLastEvent: state => {
      return { message: state.message, args: state.args };
    },
  },
  persist: false,
});
