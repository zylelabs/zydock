import type { IThemeBranding } from '~/stores/theme.store';

/**
 * The theme of the interface: name, logo, favicon and the brand colors, resolved from the
 * organization's branding. Reading it anywhere is cheap; binding it to the document happens once.
 */
export const useTheme = () => {
  const theme = useThemeStore();

  /**
   * Applies the theme to the document — reactive title, favicon and the brand colors as CSS custom
   * properties on `:root`. Registered once (from `app.vue`), so a branding change reflows the whole
   * interface without a reload, and the same values are emitted during SSR. Overriding
   * `--color-primary` is enough: every Tailwind utility built from it — including the derived
   * `strong` variant — reads the variable at paint time.
   */
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
