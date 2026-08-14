<script setup lang="ts">
  import AccessLogTable from '~/components/proxy/AccessLogTable.vue';
  import AccessStatsCharts from '~/components/proxy/AccessStatsCharts.vue';
  import AccessSummary from '~/components/proxy/AccessSummary.vue';
  import { useAccessLogFeed } from '~/composables/useAccessLogFeed';
  import { useApplications } from '~/composables/services/useApplications';
  import { useDomains } from '~/composables/services/useDomains';
  import { useProxyAccess, type AccessStatsPoint } from '~/composables/services/useProxyAccess';

  const route = useRoute();
  const session = useSessionStore();

  const applicationsApi = useApplications();
  const domainsApi = useDomains();
  const proxyAccessApi = useProxyAccess();

  const applicationId = computed(() => String(route.params.applicationId));

  type AccessShell = { applicationName: string; hasDomain: boolean };

  const { getCachedData, markFetched } = useNavigationCache();

  const {
    data: shell,
    status: shellStatus,
    error: shellError,
  } = useLazyAsyncData(
    () => `application-${applicationId.value}-access-shell`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [{ application }, domains] = await Promise.all([
        applicationsApi.get(applicationId.value),
        domainsApi.list({ applicationId: applicationId.value }),
      ]);

      markFetched(`application-${applicationId.value}-access-shell`);

      return { applicationName: application.name, hasDomain: domains.items.length > 0 };
    },
    {
      server: false,
      watch: [() => session.organizationId, applicationId],
      default: () => null as AccessShell | null,
      getCachedData: key => getCachedData(key),
    },
  );

  const applicationName = computed(() => shell.value?.applicationName ?? '');
  const hasDomain = computed(() => shell.value?.hasDomain ?? true);

  const hasLoadedOnce = useFirstLoad(shellStatus);

  useHead(() => ({ title: `Access · ${applicationName.value || 'Application'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Access',
      context: applicationName.value,
      back: `/applications/${applicationId.value}`,
    });
  });

  const { items, loading, error, live, load } = useAccessLogFeed(filters =>
    proxyAccessApi.applicationAccess(applicationId.value, filters),
  );

  const filters = reactive({ status: '' });

  const runLoad = () => load({ status: filters.status ? Number(filters.status) : undefined });

  watch(() => filters.status, runLoad);

  const statsSeries = ref<AccessStatsPoint[]>([]);
  const statsLoading = ref(true);

  const loadStats = async () => {
    statsLoading.value = true;

    try {
      const stats = await proxyAccessApi.applicationAccessStats(applicationId.value);

      statsSeries.value = stats.series;
    } finally {
      statsLoading.value = false;
    }
  };

  watch(
    shell,
    value => {
      if (!value?.hasDomain) {
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

      <EmptyState
        v-else-if="!hasDomain"
        variant="action"
        title="No domain configured"
        description="The access log tracks requests by domain. Add one to this application to see who is accessing it."
      >
        <Button theme="primary" :to="`/applications/${applicationId}`">Configure a domain</Button>
      </EmptyState>

      <template v-else>
        <AccessSummary :items="items" />

        <AccessStatsCharts :series="statsSeries" :loading="statsLoading" />

        <Alert v-if="error" theme="error">{{ error }}</Alert>

        <AccessLogTable
          v-model:live="live"
          :items="items"
          :loading="loading"
          empty-label="No requests for this application's domains yet."
        >
          <template #filters>
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
