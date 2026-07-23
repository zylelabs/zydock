<script setup lang="ts">
  import {
    APPLICATION_LABEL,
    CONTAINER_STATES,
    type ContainerInfo,
    type ContainerState,
  } from '~/composables/use-containers';
  import type { ImageInfo } from '~/composables/use-images';
  import type { NetworkInfo } from '~/composables/use-networks';
  import type { VolumeInfo } from '~/composables/use-volumes';
  import type { MetricSample, SystemMetrics } from '~/composables/use-metrics';

  const route = useRoute();
  const session = useSessionStore();
  const serverId = computed(() => String(route.params.serverId));

  const { current } = useOrganizations();
  const servers = useServers();
  const containersApi = useContainers();
  const imagesApi = useImages();
  const networksApi = useNetworks();
  const volumesApi = useVolumes();
  const metricsApi = useMetrics();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data } = await useAsyncData(
    () => `server-${serverId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const result = await servers.get(serverId.value);

      return { server: result.server };
    },
    { server: false, watch: [() => session.organizationId, serverId] },
  );

  useHead(() => ({ title: data.value?.server.name ?? 'Server' }));

  const server = computed(() => data.value?.server ?? null);

  const percent = (used = 0, total = 0) => (total ? Math.round((used / total) * 100) : 0);

  // --- Metrics snapshot + history -------------------------------------------------------------------

  const metrics = ref<SystemMetrics | null>(null);
  const metricsError = ref('');

  const loadMetrics = async () => {
    metricsError.value = '';

    try {
      metrics.value = await metricsApi.serverMetrics(serverId.value);
    } catch (error) {
      metrics.value = null;
      metricsError.value = (error as { message?: string }).message || 'Metrics unavailable.';
    }
  };

  const history = ref<MetricSample[]>([]);

  const loadHistory = async () => {
    try {
      const result = await metricsApi.serverMetricsHistory(serverId.value, { limit: 50 });
      history.value = result.items;
    } catch {
      history.value = [];
    }
  };

  const chronological = computed(() => [...history.value].reverse());

  watch(
    serverId,
    () => {
      loadMetrics();
      loadHistory();
    },
    { immediate: true },
  );

  // --- Tabs ------------------------------------------------------------------------------------

  type Tab = 'containers' | 'images' | 'networks' | 'volumes';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'containers', label: 'Containers' },
    { key: 'images', label: 'Images' },
    { key: 'networks', label: 'Networks' },
    { key: 'volumes', label: 'Volumes' },
  ];

  const activeTab = ref<Tab>('containers');
  const loadedTabs = new Set<Tab>();

  // --- Containers -----------------------------------------------------------------------------------

  const containers = ref<ContainerInfo[]>([]);
  const containersError = ref('');
  const containersLoading = ref(false);
  const stateFilter = ref<ContainerState | ''>('');
  const openLogs = ref<string | null>(null);
  const logLines = ref<{ timestamp: string; stream: string; message: string }[]>([]);
  const logsLoading = ref(false);

  const loadContainers = async () => {
    containersError.value = '';
    containersLoading.value = true;

    try {
      containers.value = await containersApi.list(serverId.value, {
        state: stateFilter.value || undefined,
      });
    } catch (error) {
      containers.value = [];
      containersError.value =
        (error as { message?: string }).message || 'Failed to list containers.';
    } finally {
      containersLoading.value = false;
    }
  };

  watch(stateFilter, loadContainers);

  const ownerOf = (container: ContainerInfo) => container.labels?.[APPLICATION_LABEL];

  const runContainerAction = async (
    container: ContainerInfo,
    action: 'start' | 'stop' | 'restart' | 'remove',
  ) => {
    actionError.value = '';
    busy.value = `${container.id}:${action}`;

    try {
      if (action === 'remove') {
        await containersApi.remove(serverId.value, container.id);
      } else {
        await containersApi[action](serverId.value, container.id);
      }

      await loadContainers();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || `Failed to ${action}.`;
    } finally {
      busy.value = '';
    }
  };

  const toggleLogs = async (container: ContainerInfo) => {
    if (openLogs.value === container.id) {
      openLogs.value = null;
      return;
    }

    openLogs.value = container.id;
    logsLoading.value = true;

    try {
      logLines.value = await containersApi.logs(serverId.value, container.id, 200);
    } catch (error) {
      logLines.value = [];
      actionError.value = (error as { message?: string }).message || 'Failed to load logs.';
    } finally {
      logsLoading.value = false;
    }
  };

  // --- Images -----------------------------------------------------------------------------------

  const images = ref<ImageInfo[]>([]);
  const imagesError = ref('');
  const imagesLoading = ref(false);
  const pullReference = ref('');
  const pulling = ref(false);

  const loadImages = async () => {
    imagesError.value = '';
    imagesLoading.value = true;

    try {
      images.value = await imagesApi.list(serverId.value);
    } catch (error) {
      images.value = [];
      imagesError.value = (error as { message?: string }).message || 'Failed to list images.';
    } finally {
      imagesLoading.value = false;
    }
  };

  const onPull = async () => {
    if (!pullReference.value.trim()) {
      return;
    }

    actionError.value = '';
    pulling.value = true;

    try {
      await imagesApi.pull(serverId.value, pullReference.value.trim());
      pullReference.value = '';
      await loadImages();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to pull the image.';
    } finally {
      pulling.value = false;
    }
  };

  const removeImage = async (image: ImageInfo) => {
    actionError.value = '';
    busy.value = `${image.id}:remove`;

    try {
      await imagesApi.remove(serverId.value, image.tag);
      await loadImages();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove the image.';
    } finally {
      busy.value = '';
    }
  };

  // --- Networks ---------------------------------------------------------------------------------

  const networks = ref<NetworkInfo[]>([]);
  const networksError = ref('');
  const networksLoading = ref(false);
  const newNetworkName = ref('');
  const creatingNetwork = ref(false);

  const loadNetworks = async () => {
    networksError.value = '';
    networksLoading.value = true;

    try {
      networks.value = await networksApi.list(serverId.value);
    } catch (error) {
      networks.value = [];
      networksError.value = (error as { message?: string }).message || 'Failed to list networks.';
    } finally {
      networksLoading.value = false;
    }
  };

  const onCreateNetwork = async () => {
    if (!newNetworkName.value.trim()) {
      return;
    }

    actionError.value = '';
    creatingNetwork.value = true;

    try {
      await networksApi.create(serverId.value, newNetworkName.value.trim());
      newNetworkName.value = '';
      await loadNetworks();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to create the network.';
    } finally {
      creatingNetwork.value = false;
    }
  };

  const removeNetwork = async (network: NetworkInfo) => {
    actionError.value = '';
    busy.value = `${network.id}:remove`;

    try {
      await networksApi.remove(serverId.value, network.name);
      await loadNetworks();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to remove the network.';
    } finally {
      busy.value = '';
    }
  };

  // --- Volumes ----------------------------------------------------------------------------------

  const volumes = ref<VolumeInfo[]>([]);
  const volumesError = ref('');
  const volumesLoading = ref(false);
  const newVolumeName = ref('');
  const creatingVolume = ref(false);

  const loadVolumes = async () => {
    volumesError.value = '';
    volumesLoading.value = true;

    try {
      volumes.value = await volumesApi.list(serverId.value);
    } catch (error) {
      volumes.value = [];
      volumesError.value = (error as { message?: string }).message || 'Failed to list volumes.';
    } finally {
      volumesLoading.value = false;
    }
  };

  const onCreateVolume = async () => {
    if (!newVolumeName.value.trim()) {
      return;
    }

    actionError.value = '';
    creatingVolume.value = true;

    try {
      await volumesApi.create(serverId.value, newVolumeName.value.trim());
      newVolumeName.value = '';
      await loadVolumes();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to create the volume.';
    } finally {
      creatingVolume.value = false;
    }
  };

  const removeVolume = async (volume: VolumeInfo) => {
    actionError.value = '';
    busy.value = `${volume.name}:remove`;

    try {
      await volumesApi.remove(serverId.value, volume.name);
      await loadVolumes();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove the volume.';
    } finally {
      busy.value = '';
    }
  };

  watch(
    activeTab,
    tab => {
      if (loadedTabs.has(tab)) {
        return;
      }

      loadedTabs.add(tab);

      if (tab === 'containers') {
        loadContainers();
      } else if (tab === 'images') {
        loadImages();
      } else if (tab === 'networks') {
        loadNetworks();
      } else {
        loadVolumes();
      }
    },
    { immediate: true },
  );

  const stateOptions = [
    { value: '', label: 'All states' },
    ...CONTAINER_STATES.map(state => ({ value: state, label: state })),
  ];
</script>

<template>
  <section v-if="server" class="mx-auto flex max-w-4xl flex-col gap-6">
    <NuxtLink
      to="/servers"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Servers
    </NuxtLink>

    <header class="flex items-center gap-3">
      <h1>{{ server.name }}</h1>
      <UiBadge v-if="server.type === 'local'" variant="neutral">local</UiBadge>
      <UiBadge v-if="server.online" variant="success">online</UiBadge>
      <UiBadge v-else variant="warning">offline</UiBadge>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard title="Metrics">
      <UiAlert v-if="metricsError" variant="error">{{ metricsError }}</UiAlert>

      <div v-if="metrics" class="grid gap-4 sm:grid-cols-2">
        <div>
          <div class="mb-1 flex justify-between text-xs text-content-muted">
            <span>CPU</span><span>{{ Math.round(metrics.cpuPercent ?? 0) }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              class="h-full bg-primary"
              :style="{ width: `${Math.min(100, metrics.cpuPercent ?? 0)}%` }"
            />
          </div>
        </div>
        <div>
          <div class="mb-1 flex justify-between text-xs text-content-muted">
            <span>Memory</span>
            <span>{{ percent(metrics.memoryUsedMb, metrics.memoryTotalMb) }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              class="h-full bg-primary"
              :style="{ width: `${percent(metrics.memoryUsedMb, metrics.memoryTotalMb)}%` }"
            />
          </div>
        </div>
      </div>

      <p v-if="metrics" class="mt-3 text-xs text-content-muted">
        {{ metrics.containersRunning }} of {{ metrics.containersTotal }} containers running · disk
        {{ percent(metrics.diskUsedGb, metrics.diskTotalGb) }}%
      </p>

      <div
        v-if="chronological.length"
        class="mt-4 flex flex-col gap-3 border-t border-surface-border pt-4"
      >
        <div>
          <p class="mb-1 text-xs text-content-muted">
            CPU history (last {{ chronological.length }} samples)
          </p>
          <div class="flex h-10 items-end gap-0.5">
            <div
              v-for="(sample, index) in chronological"
              :key="index"
              class="flex-1 rounded-t bg-primary/70"
              :style="{ height: `${Math.max(2, Math.min(100, sample.cpuPercent ?? 0))}%` }"
              :title="`${new Date(sample.capturedAt).toLocaleString('en-US')} — ${Math.round(sample.cpuPercent ?? 0)}%`"
            />
          </div>
        </div>
        <div>
          <p class="mb-1 text-xs text-content-muted">
            Memory history (last {{ chronological.length }} samples)
          </p>
          <div class="flex h-10 items-end gap-0.5">
            <div
              v-for="(sample, index) in chronological"
              :key="index"
              class="flex-1 rounded-t bg-primary/70"
              :style="{
                height: `${Math.max(2, Math.min(100, percent(sample.memoryUsedMb, sample.memoryTotalMb)))}%`,
              }"
            />
          </div>
        </div>
      </div>
    </UiCard>

    <div class="flex gap-1 border-b border-surface-border">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="border-b-2 px-3 py-2 text-sm transition-colors"
        :class="
          activeTab === tab.key
            ? 'border-primary text-content'
            : 'border-transparent text-content-muted hover:text-content'
        "
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Containers -->
    <UiCard v-if="activeTab === 'containers'" title="Containers">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Containers</h2>
          <div class="w-44">
            <UiSelect v-model="stateFilter" :options="stateOptions" />
          </div>
        </div>
      </template>

      <UiAlert v-if="containersError" variant="error">{{ containersError }}</UiAlert>
      <p v-else-if="containersLoading" class="text-sm text-content-muted">Loading…</p>
      <p v-else-if="!containers.length" class="text-sm text-content-muted">No containers found.</p>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="container in containers"
          :key="container.id"
          class="rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="flex flex-wrap items-center gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate">{{ container.name }}</h3>
                <UiBadge variant="info">{{ container.state }}</UiBadge>
                <UiBadge v-if="ownerOf(container)" variant="neutral">app-managed</UiBadge>
              </div>
              <p class="mt-1 truncate text-xs text-content-muted">{{ container.image }}</p>
              <p class="mt-1 truncate text-xs text-content-muted">
                restarts: {{ container.restartCount }}
                <span v-if="container.exitCode !== undefined">
                  · exit {{ container.exitCode }}</span
                >
              </p>
            </div>

            <div v-if="canManage" class="flex flex-wrap items-center gap-2">
              <UiButton variant="ghost" @click="toggleLogs(container)">Logs</UiButton>
              <UiButton
                v-if="container.state !== 'running'"
                variant="secondary"
                :loading="busy === `${container.id}:start`"
                @click="runContainerAction(container, 'start')"
              >
                Start
              </UiButton>
              <UiButton
                v-else
                variant="secondary"
                :loading="busy === `${container.id}:stop`"
                @click="runContainerAction(container, 'stop')"
              >
                Stop
              </UiButton>
              <UiButton
                variant="secondary"
                :loading="busy === `${container.id}:restart`"
                @click="runContainerAction(container, 'restart')"
              >
                Restart
              </UiButton>
              <button
                type="button"
                title="Remove"
                class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                @click="runContainerAction(container, 'remove')"
              >
                <Icon name="lucide:trash-2" class="size-4" />
              </button>
            </div>
          </div>

          <div
            v-if="openLogs === container.id"
            class="mt-3 rounded-lg border border-surface-border bg-surface p-3"
          >
            <p v-if="logsLoading" class="text-xs text-content-muted">Loading…</p>
            <p v-else-if="!logLines.length" class="text-xs text-content-muted">No log lines.</p>
            <pre v-else class="max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">{{
              logLines.map(line => line.message).join('\n')
            }}</pre>
          </div>
        </div>
      </div>
    </UiCard>

    <!-- Images -->
    <UiCard v-if="activeTab === 'images'" title="Images">
      <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="onPull">
        <div class="flex-1">
          <UiInput v-model="pullReference" placeholder="nginx:latest" />
        </div>
        <UiButton type="submit" variant="secondary" :loading="pulling">Pull</UiButton>
      </form>

      <UiAlert v-if="imagesError" variant="error">{{ imagesError }}</UiAlert>
      <p v-else-if="imagesLoading" class="text-sm text-content-muted">Loading…</p>
      <p v-else-if="!images.length" class="text-sm text-content-muted">No images found.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="image in images" :key="image.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ image.tag }}</p>
            <p class="truncate text-xs text-content-muted">{{ formatBytes(image.sizeBytes) }}</p>
          </div>
          <button
            v-if="canManage"
            type="button"
            title="Remove"
            class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
            @click="removeImage(image)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </li>
      </ul>
    </UiCard>

    <!-- Networks -->
    <UiCard v-if="activeTab === 'networks'" title="Networks">
      <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="onCreateNetwork">
        <div class="flex-1">
          <UiInput v-model="newNetworkName" placeholder="my-network" />
        </div>
        <UiButton type="submit" variant="secondary" :loading="creatingNetwork">Create</UiButton>
      </form>

      <UiAlert v-if="networksError" variant="error">{{ networksError }}</UiAlert>
      <p v-else-if="networksLoading" class="text-sm text-content-muted">Loading…</p>
      <p v-else-if="!networks.length" class="text-sm text-content-muted">No networks found.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="network in networks" :key="network.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ network.name }}</p>
            <p class="truncate text-xs text-content-muted">{{ network.driver }}</p>
          </div>
          <button
            v-if="canManage"
            type="button"
            title="Remove"
            class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
            @click="removeNetwork(network)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </li>
      </ul>
    </UiCard>

    <!-- Volumes -->
    <UiCard v-if="activeTab === 'volumes'" title="Volumes">
      <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="onCreateVolume">
        <div class="flex-1">
          <UiInput v-model="newVolumeName" placeholder="my-volume" />
        </div>
        <UiButton type="submit" variant="secondary" :loading="creatingVolume">Create</UiButton>
      </form>

      <UiAlert v-if="volumesError" variant="error">{{ volumesError }}</UiAlert>
      <p v-else-if="volumesLoading" class="text-sm text-content-muted">Loading…</p>
      <p v-else-if="!volumes.length" class="text-sm text-content-muted">No volumes found.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="volume in volumes" :key="volume.name" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ volume.name }}</p>
            <p class="truncate text-xs text-content-muted">{{ volume.mountpoint }}</p>
          </div>
          <button
            v-if="canManage"
            type="button"
            title="Remove"
            class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
            @click="removeVolume(volume)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </li>
      </ul>
    </UiCard>
  </section>
</template>
