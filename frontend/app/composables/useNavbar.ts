export type NavbarAction = {
  label: string;
  icon?: string;
  theme?: 'primary' | 'secondary';
  loading?: boolean;
  onClick: () => void;
};

export type Navbar = {
  title: string;
  context?: string;
  loading?: boolean;
  action?: NavbarAction;
};

/**
 * Chame sempre no setup da página, nunca dentro de `watchEffect`/`computed`: o `useState` do Nuxt
 * lê `state.value` para decidir se precisa inicializar, então chamar o composable dentro de um
 * efeito registra o próprio estado como dependência e o `set` seguinte re-dispara o efeito em loop
 * ("Maximum recursive updates exceeded").
 */
export const useNavbar = (navbar?: Partial<Navbar>) => {
  const navbarState = useState<Navbar>('navbar', () => ({ title: '' }));

  const set = (next: Partial<Navbar>) => {
    navbarState.value = {
      title: next.title ?? navbarState.value.title,
      context: next.context,
      loading: next.loading,
      action: next.action,
    };
  };

  if (navbar) {
    set(navbar);
  }

  return {
    set,
    navbar: navbarState,
  };
};
