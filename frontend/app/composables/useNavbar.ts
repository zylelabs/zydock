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
