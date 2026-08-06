import type { Paginated } from '../useApi';
import type { Organization } from '~/stores/organization.store';

export const useOrganizations = () => {
  const api = useApi();
  const store = useOrganizationStore();
  const session = useSessionStore();

  const organizations = computed(() => store.organizations);

  const current = computed(
    () =>
      store.organizations.find(organization => organization.id === session.organizationId) ?? null,
  );

  const select = (organization: Organization) => {
    session.selectOrganization(organization.id);
  };

  const load = async () => {
    const { items } = await api.get<Paginated<Organization>>('/organizations', {
      query: { size: 100 },
    });

    store.set(items);

    const active = items.find(item => item.id === session.organizationId) ?? items[0] ?? null;

    if (active) {
      select(active);
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

  const update = async (organizationId: string, body: { name?: string }) => {
    const { organization } = await api.patch<{ organization: Organization }>(
      `/organizations/${organizationId}`,
      { body },
    );

    store.upsert(organization);

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
    }
  };

  return { organizations, current, load, select, create, update, remove };
};
