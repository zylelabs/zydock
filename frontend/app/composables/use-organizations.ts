import type { Paginated } from '~/composables/use-api';
import type { Organization, OrganizationBranding } from '~/stores/organization.store';

export const useOrganizations = () => {
  const api = useApi();
  const store = useOrganizationStore();
  const session = useSessionStore();
  const { setTheme } = useTheme();

  const organizations = computed(() => store.organizations);

  const current = computed(
    () =>
      store.organizations.find(organization => organization.id === session.organizationId) ?? null,
  );

  const applyBranding = (organization: Organization | null) =>
    setTheme(organization?.name, organization?.branding);

  const select = (organization: Organization) => {
    session.selectOrganization(organization.id);
    applyBranding(organization);
  };

  const load = async () => {
    const { items } = await api.get<Paginated<Organization>>('/organizations', {
      query: { size: 100 },
    });

    store.set(items);

    const active = items.find(item => item.id === session.organizationId) ?? items[0] ?? null;

    if (active) {
      select(active);
    } else {
      applyBranding(null);
    }

    return items;
  };

  const create = async (name: string) => {
    const { organization } = await api.post<{ organization: Organization }>('/organizations', {
      body: { name },
    });

    store.upsert(organization);
    select(organization);

    return organization;
  };

  const update = async (
    organizationId: string,
    body: { name?: string; branding?: OrganizationBranding },
  ) => {
    const { organization } = await api.patch<{ organization: Organization }>(
      `/organizations/${organizationId}`,
      { body },
    );

    store.upsert(organization);

    if (organization.id === session.organizationId) {
      applyBranding(organization);
    }

    return organization;
  };

  const remove = async (organizationId: string) => {
    await api.del<{ message: string }>(`/organizations/${organizationId}`);

    store.remove(organizationId);

    if (session.organizationId !== organizationId) {
      return;
    }

    const next = store.organizations[0] ?? null;

    if (next) {
      select(next);
    } else {
      session.selectOrganization('');
      applyBranding(null);
    }
  };

  return { organizations, current, load, select, create, update, remove, applyBranding };
};
