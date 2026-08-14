import type { AsyncDataRequestStatus } from 'nuxt/app';

export const useFirstLoad = (status: Ref<AsyncDataRequestStatus>) => {
  const settled = ref(status.value === 'success' || status.value === 'error');

  watch(status, value => {
    if (value === 'success' || value === 'error') {
      settled.value = true;
    }
  });

  return computed(() => !settled.value);
};
