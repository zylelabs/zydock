import type { RouteLocationRaw } from 'vue-router';

export type NavbarBreadcrumbItem = {
  label: string;
  to?: RouteLocationRaw;
  disabled?: boolean;
};

export type NavbarBreadcrumb = {
  items?: NavbarBreadcrumbItem[];
  separator?: string;
  autoFromRoute?: boolean;
  includeHome?: boolean;
  homeLabel?: string;
  homeTo?: RouteLocationRaw;
};

export type Navbar = {
  title: string;
  breadcrumb?: NavbarBreadcrumb;
  loading?: boolean;
};

export const useNavbar = (navbar?: Partial<Navbar>) => {
  const router = useRoute();
  const titleSplit = router.name?.toString().split('-');

  const navbarState = useState<Navbar>('navbar', () => ({
    title: titleSplit?.[titleSplit?.length - 1] ?? '',
    loading: false,
  }));

  const set = (navbar: Partial<Navbar>) => {
    navbarState.value = {
      ...navbarState.value,
      ...navbar,
    };
  };

  const setBreadcrumb = (breadcrumb?: NavbarBreadcrumb) => {
    navbarState.value = {
      ...navbarState.value,
      breadcrumb,
    };
  };

  if (navbar) {
    set(navbar);
  }

  return {
    set,
    setBreadcrumb,
    navbar: navbarState,
  };
};
