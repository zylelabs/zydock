import type { IThemeBranding } from '~/stores/theme.store';

export const useTheme = () => {
  const theme = useThemeStore();

  const applyToDocument = () =>
    useHead(() => ({
      titleTemplate: (page?: string) => (page ? `${page} · ${theme.name}` : theme.name),
      link: [{ key: 'favicon', rel: 'icon', href: theme.favicon }],
      style: [
        {
          key: 'theme',
          innerHTML:
            ':root{' +
            `--color-primary:${theme.primaryColor};` +
            `--color-primary-strong:color-mix(in oklab, ${theme.primaryColor} 85%, black);` +
            `--color-secondary:${theme.secondaryColor};` +
            '}',
        },
      ],
    }));

  return {
    name: computed(() => theme.name),
    logo: computed(() => theme.logo),
    primaryColor: computed(() => theme.primaryColor),
    secondaryColor: computed(() => theme.secondaryColor),
    applyToDocument,
    setTheme: (name: string | undefined, branding: IThemeBranding | undefined) =>
      theme.apply(name, branding),
    reset: () => theme.reset(),
  };
};
