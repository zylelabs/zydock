<script setup lang="ts">
  import OrganizationSwitcher from './OrganizationSwitcher.vue';
  import { useProjects } from '~/composables/services/useProjects';
  import { useServers } from '~/composables/services/useServers';
  import { useBackups } from '~/composables/services/useBackups';
  import { useDatabases } from '~/composables/services/useDatabases';
  import {
    applicationStatusDot,
    useApplications,
    type Application,
  } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { installedVersionLabel, useHealth } from '~/composables/services/useHealth';
  import type { AppearanceMode } from '~/stores/appearance.store';

  type NavItem = {
    id: string;
    label: string;
    to?: string;
    count?: Ref<number | null>;
    match: (path: string) => boolean;
  };

  const route = useRoute();
  const { isOpen, close } = useSidebar();
  const { mode, setMode } = useAppearance();

  const { data: health, status: healthStatus } = useLazyAsyncData(
    'platform-health',
    () => useHealth().get(),
    { server: false, default: () => null },
  );

  const buildVersion = `v${useRuntimeConfig().public.version}`;
  const version = computed(() => installedVersionLabel(health.value) || buildVersion);
  const healthPending = computed(() => healthStatus.value === 'pending');
  const { current } = useOrganizations();
  const role = computed(() => current.value?.role);

  const session = useSessionStore();
  const recentApplications = useRecentApplicationsStore();

  const loggingOut = ref(false);

  const projectsCount = ref<number | null>(null);
  const applicationsCount = ref<number | null>(null);
  const databasesCount = ref<number | null>(null);
  const serversCount = ref<number | null>(null);
  const backupsCount = ref<number | null>(null);
  const countsLoading = ref(false);

  const loadCounts = async () => {
    if (!session.organizationId) {
      return;
    }

    countsLoading.value = true;

    const [projects, applications, databases, servers, backups] = await Promise.all([
      useProjects().list({ size: 1 }),
      useApplications().list({ size: 1 }),
      useDatabases().list({ size: 1 }),
      useServers().list({ size: 1 }),
      useBackups().list({ size: 1 }),
    ]).catch(() => []);

    projectsCount.value = projects?.total ?? null;
    applicationsCount.value = applications?.total ?? null;
    databasesCount.value = databases?.total ?? null;
    serversCount.value = servers?.total ?? null;
    backupsCount.value = backups?.total ?? null;
    countsLoading.value = false;
  };

  watch(() => session.organizationId, loadCounts, { immediate: true });

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', to: '/', match: path => path === '/' },
    {
      id: 'projects',
      label: 'Projects',
      to: '/projects',
      count: projectsCount,
      match: path => path.startsWith('/projects') || path === '/applications/new',
    },
    {
      id: 'applications',
      label: 'Applications',
      to: '/applications',
      count: applicationsCount,
      match: path => path.startsWith('/applications') && path !== '/applications/new',
    },
    {
      id: 'databases',
      label: 'Databases',
      to: '/databases',
      count: databasesCount,
      match: path => path.startsWith('/databases'),
    },
    {
      id: 'servers',
      label: 'Servers',
      to: '/servers',
      count: serversCount,
      match: path => path.startsWith('/servers'),
    },
    {
      id: 'backups',
      label: 'Backups',
      to: '/backups',
      count: backupsCount,
      match: path => path.startsWith('/backups'),
    },
  ];

  const isActive = (item: NavItem) => item.match(route.path);
  const isApplicationActive = (applicationId: string) =>
    route.path === `/applications/${applicationId}` ||
    route.path.startsWith(`/applications/${applicationId}/`);

  watch(
    () => route.path,
    async path => {
      const match = path.match(/^\/applications\/([^/]+)/);

      if (
        !match ||
        match[1] === 'new' ||
        !session.organizationId ||
        recentApplications.current[0]?.id === match[1]
      ) {
        return;
      }

      const applicationId = match[1]!;
      const { data: cached } = useNuxtData<Application>(`application-${applicationId}`);

      const application =
        cached.value ??
        (await useApplications()
          .get(applicationId)
          .then(({ application: item }) => item)
          .catch((error: { statusCode?: number }) => {
            if (error.statusCode === 404) {
              recentApplications.remove(session.organizationId, applicationId);
            }

            return null;
          }));

      if (application) {
        recentApplications.push(session.organizationId, {
          id: application.id,
          name: application.name,
          status: application.status,
        });
      }
    },
    { immediate: true },
  );

  const removeRecentApplication = (applicationId: string) => {
    if (!session.organizationId) {
      return;
    }

    recentApplications.remove(session.organizationId, applicationId);
  };

  const appearanceOptions: { label: string; value: AppearanceMode }[] = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'Auto', value: 'system' },
  ];

  const appearanceMode = computed<AppearanceMode>({
    get: () => mode.value,
    set: value => setMode(value),
  });

  const logout = async () => {
    loggingOut.value = true;

    const api = useApi();

    await api.post('/auth/logout').catch(() => undefined);

    useSession().endSession();
    await navigateTo('/auth/login');
  };
</script>

<template>
  <aside
    class="fixed top-0 left-0 z-40 flex h-dvh w-61 shrink-0 -translate-x-full transform flex-col gap-5.5 border-r border-edge bg-rail px-3 py-4 transition-transform duration-300 ease-in-out lg:static lg:h-full lg:translate-x-0"
    :class="isOpen && 'translate-x-0'"
  >
    <div class="flex items-center gap-2.5 px-1.5 py-1">
      <Logo class="size-6.5 shrink-0" />
      <div class="flex-1 text-heading text-ink">Zydock</div>
      <Skeleton v-if="healthPending" class="h-3 w-9" />
      <div v-else class="font-mono text-caption text-ink-3">{{ version }}</div>
    </div>

    <OrganizationSwitcher />

    <nav class="flex flex-1 flex-col gap-5.5 overflow-y-auto">
      <div class="flex flex-col gap-0.5">
        <NuxtLink
          v-for="item in navItems"
          :key="item.id"
          :to="item.to"
          class="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-body"
          :class="isActive(item) ? 'bg-rail-active text-ink' : 'text-rail-ink hover:bg-rail-hover'"
          @click="close"
        >
          <span
            class="size-1.5 shrink-0 rotate-45 rounded-[2px]"
            :class="isActive(item) ? 'bg-ink' : 'bg-rail-dot'"
          />
          <span class="flex-1">{{ item.label }}</span>
          <Skeleton v-if="item.count && countsLoading" class="h-3 w-4" />
          <span v-else-if="item.count != null" class="font-mono text-caption text-ink-3">{{
            item.count
          }}</span>
        </NuxtLink>
      </div>

      <div v-if="recentApplications.current.length" class="flex flex-col gap-0.5">
        <div class="px-2.5 pb-1.5 text-label text-ink-3 uppercase">Recent applications</div>
        <NuxtLink
          v-for="app in recentApplications.current"
          :key="app.id"
          :to="`/applications/${app.id}`"
          class="group flex items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-caption text-rail-ink hover:bg-rail-hover"
          :class="isApplicationActive(app.id) && 'bg-rail-active'"
          @click="close"
        >
          <StatusDot :status="applicationStatusDot(app.status)" />
          <span class="min-w-0 flex-1 truncate">{{ app.name }}</span>
          <button
            type="button"
            title="Remove from recent"
            class="shrink-0 cursor-pointer text-ink-3 opacity-0 hover:text-failed focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            @click.stop="removeRecentApplication(app.id)"
          >
            <Icon name="lucide:x" class="size-3" />
          </button>
        </NuxtLink>
      </div>
    </nav>

    <div class="flex flex-col gap-3 border-t border-hairline pt-3">
      <Segmented v-model="appearanceMode" :options="appearanceOptions" class="w-full" />

      <Dropdown alignment-x="right" alignment-y="top">
        <template #button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded-button border border-edge bg-page p-1.5 text-left hover:border-edge-strong"
          >
            <Avatar :name="session.user?.name ?? ''" class="size-6.5 shrink-0 text-label" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-caption font-medium text-ink">
                {{ session.user?.name }}
              </span>
              <span v-if="role" class="block truncate text-caption text-ink-3 capitalize">
                {{ role }}
              </span>
            </span>
          </button>
        </template>

        <div class="flex flex-col">
          <NuxtLink
            to="/account"
            class="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-body text-ink-2 transition-colors hover:bg-inset hover:text-ink"
            @click="close"
          >
            <Icon name="lucide:user" class="size-4" />
            Account
          </NuxtLink>

          <NuxtLink
            to="/settings"
            class="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-body text-ink-2 transition-colors hover:bg-inset hover:text-ink"
            @click="close"
          >
            <Icon name="lucide:settings" class="size-4" />
            Settings
          </NuxtLink>

          <div class="my-1 border-t border-hairline" />

          <button
            type="button"
            :disabled="loggingOut"
            class="flex w-full cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-left text-body text-ink-2 transition-colors hover:bg-inset hover:text-ink disabled:opacity-60"
            @click.stop="logout"
          >
            <Icon
              :name="loggingOut ? 'lucide:loader-circle' : 'lucide:log-out'"
              :class="['size-4', loggingOut && 'animate-spin']"
            />
            Logout
          </button>
        </div>
      </Dropdown>
    </div>
  </aside>
</template>
