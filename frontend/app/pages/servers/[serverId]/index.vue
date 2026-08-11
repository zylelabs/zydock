<script setup lang="ts">
  import DockerPanel from '~/components/servers/DockerPanel.vue';
  import EditServerPanel from '~/components/servers/EditServerPanel.vue';
  import ProvisioningCard from '~/components/servers/ProvisioningCard.vue';
  import { useMetrics, type SystemMetrics } from '~/composables/services/useMetrics';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import {
    serverStatusDot,
    useServers,
    type ProvisioningResult,
    type ServerStatus,
  } from '~/composables/services/useServers';

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const servers = useServers();
  const metricsApi = useMetrics();
  const { subscribe } = useWebSocket();

  const serverId = computed(() => String(route.params.serverId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh } = useLazyAsyncData(
    () => `server-${serverId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const result = await servers.get(serverId.value);

      markFetched(`server-${serverId.value}`);

      return { server: result.server };
    },
    {
      server: false,
      watch: [() => session.organizationId, serverId],
      default: () => null,
      getCachedData: key => getCachedData(key),
    },
  );

  const server = computed(() => data.value?.server ?? null);

  const STATUS_LABEL: Record<ServerStatus, string> = {
    pending: 'Pending',
    validating: 'Validating',
    provisioning: 'Provisioning',
    online: 'Online',
    offline: 'Offline',
    failed: 'Failed',
  };

  useHead(() => ({ title: server.value?.name ?? 'Server' }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({ title: server.value?.name ?? 'Server', context: 'Servers', back: '/servers' });
  });

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const editing = ref(false);

  const refreshing = ref(false);

  const handleRefreshServer = async () => {
    refreshing.value = true;

    try {
      const probe = await servers.refresh(serverId.value);

      if (!probe.reachable) {
        toast.error({ title: 'Error', message: probe.error || 'The server is unreachable.' });
      }

      await refresh();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to refresh the server.') });
    } finally {
      refreshing.value = false;
    }
  };

  const provisioning = ref(false);
  const provisioningResults = ref<ProvisioningResult[]>([]);

  const canProvision = computed(
    () =>
      server.value?.type === 'ssh' &&
      ['pending', 'failed', 'offline'].includes(server.value.status),
  );

  const applyProvisioningStep = (incoming: ProvisioningResult) => {
    const index = provisioningResults.value.findIndex(step => step.step === incoming.step);

    if (index === -1) {
      provisioningResults.value.push(incoming);
      return;
    }

    provisioningResults.value[index] = incoming;
  };

  const handleProvision = async () => {
    provisioningResults.value = [];
    provisioning.value = true;

    const stop = subscribe(servers.provisioningTopic(serverId.value), message => {
      if (message.event === 'provisioning.step') {
        applyProvisioningStep(message.data as ProvisioningResult);
      }
    });

    try {
      const result = await servers.provision(serverId.value);

      provisioningResults.value = result.steps;
      await refresh();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to provision the server.') });
    } finally {
      provisioning.value = false;
      stop();
    }
  };

  const metrics = ref<SystemMetrics | null>(null);

  const loadMetrics = async () => {
    try {
      metrics.value = await metricsApi.serverMetrics(serverId.value);
    } catch {
      metrics.value = null;
    }
  };

  watch(serverId, loadMetrics, { immediate: true });

  const toRemove = ref(false);
  const removing = ref(false);

  const handleRemove = async () => {
    removing.value = true;

    try {
      await servers.remove(serverId.value);
      await navigateTo('/servers');
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to remove the server.') });
      removing.value = false;
    }
  };
</script>

<template>
  <Content v-if="server">
    <div class="mx-auto flex max-w-225 flex-col">
      <div class="mb-4.5 flex flex-wrap items-center gap-2.5">
        <Tag v-if="server.type === 'local'">local</Tag>
        <div
          class="flex items-center gap-1.5 rounded-full border border-edge bg-card px-2.75 py-1.25 text-[12.5px] text-ink"
        >
          <StatusDot :status="serverStatusDot(server.status)" />
          {{ STATUS_LABEL[server.status] }}
        </div>

        <div class="flex-1" />

        <Button theme="secondary" size="sm" :to="`/servers/${serverId}/access`"> Access </Button>

        <template v-if="canManage">
          <Button theme="secondary" size="sm" @click="editing = true"> Edit </Button>
          <Button
            v-if="server.type === 'ssh'"
            theme="secondary"
            size="sm"
            :disabled="refreshing"
            @click="handleRefreshServer"
          >
            <Icon v-if="refreshing" name="svg-spinners:tadpole" size="16" />
            Refresh
          </Button>
          <Button
            v-if="canProvision"
            theme="primary"
            size="sm"
            :disabled="provisioning"
            @click="handleProvision"
          >
            <Icon v-if="provisioning" name="svg-spinners:tadpole" size="16" />
            Provision
          </Button>
        </template>
      </div>

      <div class="flex flex-col gap-4.5">
        <EditServerPanel v-model:open="editing" :server="server" @updated="refresh" />

        <ProvisioningCard :running="provisioning" :results="provisioningResults" />

        <Card title="Metrics">
          <p v-if="!metrics" class="text-caption text-ink-2">Metrics unavailable.</p>

          <template v-else>
            <div class="grid gap-4 sm:grid-cols-3">
              <Gauge
                label="CPU"
                :value="`${Math.round(metrics.cpuPercent ?? 0)}%`"
                :percent="metrics.cpuPercent ?? 0"
              />
              <Gauge
                label="Memory"
                :value="`${percent(metrics.memoryUsedMb, metrics.memoryTotalMb)}%`"
                :percent="percent(metrics.memoryUsedMb, metrics.memoryTotalMb)"
              />
              <Gauge
                label="Disk"
                :value="`${percent(metrics.diskUsedGb, metrics.diskTotalGb)}%`"
                :percent="percent(metrics.diskUsedGb, metrics.diskTotalGb)"
              />
            </div>

            <p class="mt-3.5 text-caption text-ink-2">
              {{ metrics.containersRunning }} of {{ metrics.containersTotal }} containers running
            </p>
          </template>
        </Card>

        <DockerPanel :server-id="serverId" :can-manage="canManage" />

        <div
          v-if="canManage && !server.managed"
          class="flex items-center gap-4 rounded-card border border-failed/30 bg-failed/5 p-4.25"
        >
          <div class="flex-1">
            <div class="text-[13px] font-semibold text-failed">Remove this server</div>
            <div class="mt-0.75 text-caption text-ink-2">
              Applications and databases must be moved first.
            </div>
          </div>
          <Button theme="destructive" size="sm" class="shrink-0" @click="toRemove = true"
            >Remove</Button
          >
        </div>
      </div>
    </div>

    <Confirm
      v-model:open="toRemove"
      title="Remove server"
      :message="`Remove “${server.name}”? Applications and databases must be moved first.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </Content>

  <Content v-else>
    <div class="mx-auto flex max-w-225 flex-col">
      <div class="mb-4.5 flex flex-wrap items-center gap-2.5">
        <Skeleton class="h-7 w-24 rounded-full" />
        <div class="flex-1" />
        <Skeleton class="h-8 w-20" />
      </div>

      <div class="flex flex-col gap-4.5">
        <SkeletonCard :rows="3" />
        <div class="grid gap-4 sm:grid-cols-3">
          <SkeletonChart v-for="index in 3" :key="index" />
        </div>
      </div>
    </div>
  </Content>
</template>
