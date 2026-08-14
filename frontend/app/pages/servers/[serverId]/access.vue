<script setup lang="ts">
  import AccessLogTable from '~/components/proxy/AccessLogTable.vue';
  import AccessStatsCharts from '~/components/proxy/AccessStatsCharts.vue';
  import AccessSummary from '~/components/proxy/AccessSummary.vue';
  import AccessTopHosts from '~/components/proxy/AccessTopHosts.vue';
  import { useAccessLogFeed } from '~/composables/useAccessLogFeed';
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    useProxyAccess,
    type AccessLogEntry,
    type AccessStatsHost,
    type AccessStatsPoint,
  } from '~/composables/services/useProxyAccess';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const session = useSessionStore();

  const serversApi = useServers();
  const applicationsApi = useApplications();
  const proxyAccessApi = useProxyAccess();

  const serverId = computed(() => String(route.params.serverId));
  const isSuperuser = computed(() => Boolean(session.user?.superuser));

  type AccessShell = { serverName: string; applications: Application[] };

  const { getCachedData, markFetched } = useNavigationCache();

  const {
    data: shell,
    status: shellStatus,
    error: shellError,
  } = useLazyAsyncData(
    () => `server-${serverId.value}-access-shell`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [{ server }, applicationList] = await Promise.all([
        serversApi.get(serverId.value),
        applicationsApi.list({ serverId: serverId.value }),
      ]);

      markFetched(`server-${serverId.value}-access-shell`);

      return { serverName: server.name, applications: applicationList.items };
    },
    {
      server: false,
      watch: [() => session.organizationId, serverId],
      default: () => null as AccessShell | null,
      getCachedData: key => getCachedData(key),
    },
  );

  const serverName = computed(() => shell.value?.serverName ?? '');
  const applications = computed(() => shell.value?.applications ?? []);

  const hasLoadedOnce = useFirstLoad(shellStatus);

  useHead(() => ({ title: `Access · ${serverName.value || 'Server'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: 'Access', context: serverName.value, back: `/servers/${serverId.value}` });
  });

  const { items, loading, error, filtered, live, load } = useAccessLogFeed(filters =>
    proxyAccessApi.serverAccess(serverId.value, filters),
  );

  const filters = reactive({ host: '', applicationId: '', status: '' });

  const applicationOptions = computed(() => [
    { value: '', label: 'All applications' },
    ...applications.value.map(application => ({ value: application.id, label: application.name })),
  ]);

  const visibleItems = computed(() =>
    filters.applicationId
      ? items.value.filter(entry => entry.applicationId === filters.applicationId)
      : items.value,
  );

  const runLoad = () =>
    load({
      host: filters.host || undefined,
      status: filters.status ? Number(filters.status) : undefined,
    });

  watch([() => filters.host, () => filters.status], runLoad);

  const handleHostClick = (entry: AccessLogEntry) => {
    if (entry.applicationId) {
      navigateTo(`/applications/${entry.applicationId}/access`);
    }
  };

  const statsSeries = ref<AccessStatsPoint[]>([]);
  const topHosts = ref<AccessStatsHost[]>([]);
  const statsLoading = ref(true);

  const loadStats = async () => {
    statsLoading.value = true;

    try {
      const stats = await proxyAccessApi.serverAccessStats(serverId.value);

      statsSeries.value = stats.series;
      topHosts.value = stats.topHosts;
    } finally {
      statsLoading.value = false;
    }
  };

  watch(
    shell,
    value => {
      if (!value) {
        return;
      }

      runLoad();
      loadStats();
    },
    { immediate: true },
  );
</script>

<template>
  <Content>
    <div class="flex flex-col gap-4.5">
      <template v-if="shellStatus === 'pending' && !hasLoadedOnce">
        <SkeletonCard :rows="3" />
        <SkeletonChart />
        <SkeletonRow v-for="index in 4" :key="index" />
      </template>

      <Alert v-else-if="shellError" theme="error">{{ shellError.message }}</Alert>

      <template v-else>
        <Alert v-if="filtered && !isSuperuser" theme="warning">
          This view is filtered to your organization's hosts. Only a superuser sees every host on
          this server.
        </Alert>

        <AccessSummary :items="visibleItems" />

        <AccessStatsCharts :series="statsSeries" :loading="statsLoading" />

        <AccessTopHosts :hosts="topHosts" />

        <Alert v-if="error" theme="error">{{ error }}</Alert>

        <AccessLogTable
          v-model:live="live"
          :items="visibleItems"
          :loading="loading"
          show-application
          clickable-host
          empty-label="No requests reached this server's proxy yet."
          @host-click="handleHostClick"
        >
          <template #filters>
            <input
              v-model="filters.host"
              placeholder="Filter by host"
              class="w-44 rounded-control border border-edge bg-card px-3 py-1.5 text-caption text-ink outline-none placeholder:text-ink-3 focus:border-edge-strong"
            />
            <Select
              v-model="filters.applicationId"
              :options="applicationOptions"
              class="w-48"
              boxed
              bare
            />
            <input
              v-model="filters.status"
              type="number"
              placeholder="Status"
              class="w-24 rounded-control border border-edge bg-card px-3 py-1.5 text-caption text-ink outline-none placeholder:text-ink-3 focus:border-edge-strong"
            />
          </template>
        </AccessLogTable>
      </template>
    </div>
  </Content>
</template>
