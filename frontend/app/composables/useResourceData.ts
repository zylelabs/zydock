type UseLazyAsyncData = typeof useLazyAsyncData;

const useResourceDataImpl = (key: any, handler: any, options?: any) => {
  const asyncData = useLazyAsyncData(key, handler, {
    ...options,
    getCachedData: () => undefined,
  });

  const refreshOnVisible = () => {
    if (document.visibilityState === 'visible') {
      asyncData.refresh();
    }
  };

  onMounted(() => document.addEventListener('visibilitychange', refreshOnVisible));
  onUnmounted(() => document.removeEventListener('visibilitychange', refreshOnVisible));

  return asyncData;
};

export const useResourceData = useResourceDataImpl as UseLazyAsyncData;
