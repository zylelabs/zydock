export const usePageVisibility = () => {
  const visible = ref(true);

  const update = () => {
    visible.value = document.visibilityState === 'visible';
  };

  onMounted(() => {
    update();
    document.addEventListener('visibilitychange', update);
  });

  onUnmounted(() => document.removeEventListener('visibilitychange', update));

  return visible;
};
