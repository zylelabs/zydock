<script setup lang="ts">
  import AccessLogTable from '~/components/proxy/AccessLogTable.vue';
  import AccessStatsCharts from '~/components/proxy/AccessStatsCharts.vue';
  import AccessSummary from '~/components/proxy/AccessSummary.vue';
  import { useAccessLogFeed } from '~/composables/useAccessLogFeed';
  import { useDomains } from '~/composables/services/useDomains';
  import { useProxyAccess, type AccessStatsPoint } from '~/composables/services/useProxyAccess';

  const props = defineProps<{ applicationId: string }>();

  const session = useSessionStore();

  const domainsApi = useDomains();
  const proxyAccessApi = useProxyAccess();

  const emptyDomains = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const {
    data: domainsData,
    status: domainsStatus,
    error: domainsError,
  } = useLazyAsyncData(
    () => `application-${props.applicationId}-access-domains`,
    () =>
      session.organizationId
        ? domainsApi.list({ applicationId: props.applicationId })
        : Promise.resolve(emptyDomains),
    {
      server: false,
      watch: [() => session.organizationId, () => props.applicationId],
      default: () => emptyDomains,
    },
  );

  const hasDomain = computed(() => (domainsData.value?.items.length ?? 0) > 0);

  const isFirstLoad = useFirstLoad(domainsStatus);

  const { items, loading, error, live, load } = useAccessLogFeed(filters =>
    proxyAccessApi.applicationAccess(props.applicationId, filters),
  );

  const filters = reactive({ status: '' });

  const runLoad = () => load({ status: filters.status ? Number(filters.status) : undefined });

  watch(() => filters.status, runLoad);

  const statsSeries = ref<AccessStatsPoint[]>([]);
  const statsLoading = ref(true);

  const loadStats = async () => {
    statsLoading.value = true;

    try {
      const stats = await proxyAccessApi.applicationAccessStats(props.applicationId);

      statsSeries.value = stats.series;
    } finally {
      statsLoading.value = false;
    }
  };

  watch(
    hasDomain,
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
  <div class="flex flex-col gap-4.5">
    <template v-if="isFirstLoad">
      <SkeletonCard :rows="3" />
      <SkeletonChart />
      <SkeletonRow v-for="index in 4" :key="index" />
    </template>

    <Alert v-else-if="domainsError" theme="error">{{ domainsError.message }}</Alert>

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
</template>
