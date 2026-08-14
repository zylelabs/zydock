<script setup lang="ts">
  import AddServerPanel from '~/components/servers/AddServerPanel.vue';
  import { useMetrics, type SystemMetrics } from '~/composables/services/useMetrics';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { serverStatusDot, useServers, type Server } from '~/composables/services/useServers';

  useHead({ title: 'Servers' });

  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const { list, provision, remove } = useServers();
  const { serverMetrics } = useMetrics();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const load = async () => {
    const servers = await list();

    return { items: servers.items };
  };

  const empty = {
    items: [] as Server[],
  };

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh, status } = useLazyAsyncData(
    'servers',
    async () => {
      const result = session.organizationId ? await load() : empty;

      markFetched('servers');

      return result;
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => empty,
      getCachedData: key => getCachedData(key),
    },
  );

  const servers = computed(() => data.value?.items ?? []);

  const hasLoadedOnce = useFirstLoad(status);

  const metricsByServer = reactive(new Map<string, SystemMetrics>());
  const metricsLoading = reactive(new Set<string>());

  const loadServerMetrics = async (serverId: string) => {
    if (metricsByServer.has(serverId) || metricsLoading.has(serverId)) {
      return;
    }

    metricsLoading.add(serverId);

    try {
      metricsByServer.set(serverId, await serverMetrics(serverId));
    } catch {
      // metrics unavailable for an offline or unreachable server
    } finally {
      metricsLoading.delete(serverId);
    }
  };

  watch(
    servers,
    items => {
      items.forEach(server => loadServerMetrics(server.id));
    },
    { immediate: true },
  );

  const metricsFor = (server: Server) => metricsByServer.get(server.id) ?? null;

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  const adding = ref(false);

  const openAdd = () => {
    adding.value = true;
  };

  const handleCreated = async () => {
    await refresh();
  };

  const provisioning = ref('');

  const handleProvision = async (server: Server) => {
    provisioning.value = server.id;

    try {
      await provision(server.id);
      await refresh();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to provision the server.') });
    } finally {
      provisioning.value = '';
    }
  };

  const toRemove = ref<Server | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const openRemove = (server: Server) => {
    toRemove.value = server;
    confirmRemoveOpen.value = true;
  };

  const handleRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await remove(toRemove.value.id);
      await refresh();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to remove the server.') });
    } finally {
      removing.value = false;
    }
  };

  const canProvision = (server: Server) =>
    server.type === 'ssh' && ['pending', 'failed', 'offline'].includes(server.status);

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Servers',
      context: current.value?.name,
      action:
        current.value && canManage.value && !adding.value
          ? { label: 'Add server', icon: 'proicons:add', onClick: openAdd }
          : undefined,
    });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector to manage servers."
    />

    <div v-else class="flex max-w-225 flex-col gap-4.5">
      <AddServerPanel v-model:open="adding" @created="handleCreated" />

      <div v-if="status === 'pending' && !hasLoadedOnce" class="flex flex-col gap-2">
        <Skeleton v-for="index in 4" :key="index" class="h-20" />
      </div>

      <EmptyState
        v-else-if="!servers.length"
        variant="action"
        title="No servers yet."
        description="The local server should already be here — check the agent's logs, or add a remote server via SSH."
      >
        <Button theme="primary" @click="openAdd">Add server</Button>
      </EmptyState>

      <Card v-else content-class="p-0">
        <Row v-for="server in servers" :key="server.id" as="div" class="grid-cols-[1.4fr_1fr_auto]">
          <NuxtLink
            :to="`/servers/${server.id}`"
            class="flex min-w-0 items-center gap-2.75 after:absolute after:inset-0"
          >
            <StatusDot :status="serverStatusDot(server.status)" />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-body font-medium text-ink">{{ server.name }}</span>
                <Tag v-if="server.type === 'local'">local</Tag>
              </div>
              <div class="truncate font-mono text-caption text-ink-2">
                {{
                  server.type === 'local'
                    ? `${server.agent.host}:${server.agent.port}`
                    : server.ssh.host
                }}
                <span v-if="server.resources.osRelease"> · {{ server.resources.osRelease }}</span>
              </div>
            </div>
          </NuxtLink>

          <div v-if="metricsLoading.has(server.id)" class="flex flex-col gap-1.5">
            <SkeletonChart :label="false" />
            <SkeletonChart :label="false" />
          </div>
          <div v-else-if="metricsFor(server)" class="flex flex-col gap-1.5">
            <Gauge
              label="CPU"
              :value="`${Math.round(metricsFor(server)?.cpuPercent ?? 0)}%`"
              :percent="metricsFor(server)?.cpuPercent ?? 0"
            />
            <Gauge
              label="Memory"
              :value="`${percent(metricsFor(server)?.memoryUsedMb, metricsFor(server)?.memoryTotalMb)}%`"
              :percent="
                percent(metricsFor(server)?.memoryUsedMb, metricsFor(server)?.memoryTotalMb)
              "
            />
          </div>
          <div v-else class="text-caption text-ink-3">Metrics unavailable</div>

          <div class="relative flex items-center gap-1.5">
            <Button
              v-if="canManage && canProvision(server)"
              theme="secondary"
              size="xs"
              :disabled="provisioning === server.id"
              @click="handleProvision(server)"
            >
              <Icon v-if="provisioning === server.id" name="svg-spinners:tadpole" size="14" />
              Provision
            </Button>
            <button
              v-if="canManage && !server.managed"
              type="button"
              title="Remove server"
              class="cursor-pointer rounded-button p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
              @click="openRemove(server)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </Row>
      </Card>
    </div>

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove server"
      :message="`Remove “${toRemove?.name}”? Applications and databases must be moved first.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </Content>
</template>
