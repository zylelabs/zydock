<script setup lang="ts">
  import AccessTab from './.AccessTab.vue';
  import RuntimeTab from './.RuntimeTab.vue';
  import { useApplications, type ApplicationService } from '~/composables/services/useApplications';

  const route = useRoute();
  const session = useSessionStore();

  const applications = useApplications();

  const applicationId = computed(() => String(route.params.applicationId));

  type LogsShell = { applicationName: string; services: ApplicationService[] };

  const { getCachedData, markFetched } = useNavigationCache();

  const {
    data: shell,
    status: shellStatus,
    error: shellError,
  } = useLazyAsyncData(
    () => `application-${applicationId.value}-logs-shell`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { application } = await applications.get(applicationId.value);
      const services =
        application.source === 'compose'
          ? (await applications.services(applicationId.value)).services
          : [];

      markFetched(`application-${applicationId.value}-logs-shell`);

      return { applicationName: application.name, services };
    },
    {
      server: false,
      watch: [() => session.organizationId, applicationId],
      default: () => null as LogsShell | null,
      getCachedData: key => getCachedData(key),
    },
  );

  const applicationName = computed(() => shell.value?.applicationName ?? '');
  const services = computed(() => shell.value?.services ?? []);

  const shellFirstLoad = useFirstLoad(shellStatus);

  type TabId = 'runtime' | 'access';

  const TABS: { id: TabId; label: string }[] = [
    { id: 'runtime', label: 'Runtime' },
    { id: 'access', label: 'Access' },
  ];

  const TAB_TITLE: Record<TabId, string> = {
    runtime: 'Runtime logs',
    access: 'Access logs',
  };

  const isTab = (value: unknown): value is TabId => TABS.some(tab => tab.id === value);

  const activeTab = ref<TabId>(isTab(route.query.view) ? route.query.view : 'runtime');

  useHead(() => ({
    title: `${TAB_TITLE[activeTab.value]} · ${applicationName.value || 'Application'}`,
  }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Logs',
      context: applicationName.value,
      back: `/applications/${applicationId.value}`,
    });
  });
</script>

<template>
  <Content>
    <div v-if="shellFirstLoad" class="flex flex-col gap-4">
      <div class="flex gap-2">
        <Skeleton v-for="index in 2" :key="index" class="h-8 w-24" />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Skeleton class="h-9 max-w-75 flex-1" />
        <Skeleton class="h-9 w-28" />
        <div class="flex-1" />
        <Skeleton class="h-9 w-24" />
        <Skeleton class="h-9 w-28" />
      </div>
      <Skeleton class="h-[65vh] rounded-card" />
    </div>

    <Alert v-else-if="shellError" theme="error">{{ shellError.message }}</Alert>

    <div v-else class="flex flex-col gap-4.5">
      <Tabs v-model="activeTab" :tabs="TABS" />

      <RuntimeTab
        v-if="activeTab === 'runtime'"
        :application-id="applicationId"
        :services="services"
      />
      <AccessTab v-else :application-id="applicationId" />
    </div>
  </Content>
</template>
