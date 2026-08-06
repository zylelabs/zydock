import type { AppearanceMode } from '~/stores/appearance.store';

let watching = false;

const resolveIsDark = (mode: AppearanceMode, prefersDark: boolean) =>
  mode === 'system' ? prefersDark : mode === 'dark';

export const useAppearance = () => {
  const store = useAppearanceStore();

  const applyClass = (isDark: boolean) => {
    document.documentElement.classList.toggle('dark', isDark);
  };

  if (import.meta.client && !watching) {
    watching = true;

    const media = window.matchMedia('(prefers-color-scheme: dark)');

    watch(
      () => store.mode,
      mode => applyClass(resolveIsDark(mode, media.matches)),
      { immediate: true },
    );

    media.addEventListener('change', event => {
      if (store.mode === 'system') {
        applyClass(event.matches);
      }
    });
  }

  return {
    mode: computed(() => store.mode),
    setMode: (mode: AppearanceMode) => store.setMode(mode),
  };
};
