import type { AsyncDataRequestStatus } from 'nuxt/app';

export const useFirstLoad = (status: Ref<AsyncDataRequestStatus>) => {
  const loadedOnce = ref(false);

  watch(
    status,
    value => {
      if (value !== 'pending') {
        loadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  return loadedOnce;
};
