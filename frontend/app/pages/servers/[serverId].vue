<script setup lang="ts">
  import { z } from 'zod';
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
  import type {
    ProvisioningResult,
    ProvisioningStepName,
    SshCredentials,
  } from '~/composables/use-servers';

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
  const { subscribe } = useWebSocket();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
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

  // --- Edit server ------------------------------------------------------------------------------

  const editSchema = z
    .object({
      name: z.string().trim().min(1, 'Enter a name'),
      changeSsh: z.boolean(),
      host: z.string(),
      port: z.string(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
      password: z.string(),
      privateKey: z.string(),
      passphrase: z.string(),
    })
    .superRefine((value, ctx) => {
      if (!value.changeSsh) {
        return;
      }

      if (!value.host.trim()) {
        ctx.addIssue({ code: 'custom', path: ['host'], message: 'Enter the host' });
      }

      if (!/^\d+$/.test(value.port)) {
        ctx.addIssue({ code: 'custom', path: ['port'], message: 'Invalid port' });
      }

      if (!value.username.trim()) {
        ctx.addIssue({ code: 'custom', path: ['username'], message: 'Enter the user' });
      }

      if (value.authMethod === 'password' && !value.password) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter the password' });
      }

      if (value.authMethod === 'privateKey' && !value.privateKey) {
        ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Enter the private key' });
      }
    });

  const editForm = useForm(editSchema, {
    name: '',
    changeSsh: false,
    host: '',
    port: '22',
    username: 'root',
    authMethod: 'password' as 'password' | 'privateKey',
    password: '',
    privateKey: '',
    passphrase: '',
  });

  const authOptions = [
    { value: 'password', label: 'Password' },
    { value: 'privateKey', label: 'Private key' },
  ];

  const editing = ref(false);

  const openEdit = () => {
    if (!server.value) {
      return;
    }

    editForm.reset();
    editForm.values.name = server.value.name;
    editForm.values.host = server.value.ssh.host ?? '';
    editForm.values.username = server.value.ssh.username ?? 'root';
    editForm.values.port = String(server.value.ssh.port ?? 22);
    editing.value = true;
  };

  const buildSsh = (values: typeof editForm.values): SshCredentials => ({
    host: values.host,
    port: Number(values.port),
    username: values.username,
    ...(values.authMethod === 'password'
      ? { password: values.password }
      : { privateKey: values.privateKey, passphrase: values.passphrase || undefined }),
  });

  const onSaveEdit = editForm.submit(async values => {
    await servers.update(serverId.value, {
      name: values.name,
      ...(values.changeSsh ? { ssh: buildSsh(values) } : {}),
    });

    await refresh();
    editing.value = false;
  });

  // --- Refresh server -----------------------------------------------------------------------------

  const refreshing = ref(false);
  const refreshError = ref('');

  const onRefreshServer = async () => {
    refreshError.value = '';
    refreshing.value = true;

    try {
      const probe = await servers.refresh(serverId.value);

      if (!probe.reachable) {
        refreshError.value = probe.error || 'The server is unreachable.';
      }

      await refresh();
    } catch (error) {
      refreshError.value =
        (error as { message?: string }).message || 'Failed to refresh the server.';
    } finally {
      refreshing.value = false;
    }
  };

  // --- Live provisioning (WebSocket) ---------------------------------------------------------------

  const PROVISIONING_STEP_LABEL: Record<ProvisioningStepName, string> = {
    connect: 'Connect',
    'install-docker': 'Install Docker',
    'install-runtime': 'Install runtime',
    'install-proxy': 'Install proxy',
    'upload-agent': 'Upload agent',
    'configure-agent': 'Configure agent',
    'start-agent': 'Start agent',
    'verify-agent': 'Verify agent',
  };

  const provisioning = ref(false);
  const provisioningSteps = ref<ProvisioningResult[]>([]);
  const provisioningError = ref('');

  const canProvision = computed(
    () =>
      server.value?.type === 'ssh' &&
      ['pending', 'failed', 'offline'].includes(server.value.status),
  );

  const onProvisioningStep = (incoming: ProvisioningResult) => {
    const index = provisioningSteps.value.findIndex(step => step.step === incoming.step);

    if (index === -1) {
      provisioningSteps.value.push(incoming);
    } else {
      provisioningSteps.value[index] = incoming;
    }
  };

  const runProvision = async () => {
    provisioningError.value = '';
    provisioningSteps.value = [];
    provisioning.value = true;

    const stop = subscribe(servers.provisioningTopic(serverId.value), message => {
      if (message.event === 'provisioning.step') {
        onProvisioningStep(message.data as ProvisioningResult);
      }
    });

    try {
      const result = await servers.provision(serverId.value);
      provisioningSteps.value = result.steps;
      await refresh();
    } catch (error) {
      provisioningError.value =
        (error as { message?: string }).message || 'Failed to provision the server.';
    } finally {
      provisioning.value = false;
      stop();
    }
  };

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

  // --- Reverse proxy (Caddy) ---------------------------------------------------------------------

  /** Stable name the provisioning script gives the Caddy container — `provisioning.service.ts`. */
  const PROXY_CONTAINER_NAME = 'zydock-proxy';

  const proxyContainer = ref<ContainerInfo | null>(null);
  const proxyLogsOpen = ref(false);
  const proxyLogLines = ref<{ timestamp: string; stream: string; message: string }[]>([]);
  const proxyLogsLoading = ref(false);
  const proxyError = ref('');

  const loadProxyContainer = async () => {
    try {
      const found = await containersApi.list(serverId.value, { namePrefix: PROXY_CONTAINER_NAME });
      proxyContainer.value = found[0] ?? null;
    } catch {
      proxyContainer.value = null;
    }
  };

  const toggleProxyLogs = async () => {
    if (!proxyContainer.value) {
      return;
    }

    if (proxyLogsOpen.value) {
      proxyLogsOpen.value = false;
      return;
    }

    proxyLogsOpen.value = true;
    proxyLogsLoading.value = true;
    proxyError.value = '';

    try {
      proxyLogLines.value = await containersApi.logs(serverId.value, proxyContainer.value.id, 200);
    } catch (error) {
      proxyLogLines.value = [];
      proxyError.value = (error as { message?: string }).message || 'Failed to load logs.';
    } finally {
      proxyLogsLoading.value = false;
    }
  };

  watch(serverId, loadProxyContainer, { immediate: true });

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

    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h1>{{ server.name }}</h1>
        <UiBadge v-if="server.type === 'local'" variant="neutral">local</UiBadge>
        <UiBadge v-if="server.online" variant="success">online</UiBadge>
        <UiBadge v-else variant="warning">offline</UiBadge>
      </div>

      <div v-if="canManage" class="flex items-center gap-2">
        <UiButton variant="ghost" type="button" @click="openEdit">Edit</UiButton>
        <UiButton
          v-if="server.type === 'ssh'"
          variant="ghost"
          type="button"
          :loading="refreshing"
          @click="onRefreshServer"
        >
          Refresh
        </UiButton>
        <UiButton
          v-if="canProvision"
          variant="secondary"
          type="button"
          :loading="provisioning"
          @click="runProvision"
        >
          Provision
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>
    <UiAlert v-if="refreshError" variant="error">{{ refreshError }}</UiAlert>

    <UiCard v-if="editing" title="Edit server">
      <form class="flex flex-col gap-4" @submit.prevent="onSaveEdit">
        <UiAlert v-if="editForm.formError.value" variant="error">{{
          editForm.formError.value
        }}</UiAlert>

        <UiInput v-model="editForm.values.name" label="Name" :error="editForm.errors.value.name" />

        <template v-if="server.type === 'ssh'">
          <UiCheckbox v-model="editForm.values.changeSsh" label="Change SSH credentials" />

          <template v-if="editForm.values.changeSsh">
            <div class="grid gap-4 sm:grid-cols-2">
              <UiInput
                v-model="editForm.values.username"
                label="SSH user"
                :error="editForm.errors.value.username"
              />
              <UiSelect
                v-model="editForm.values.authMethod"
                label="Authentication"
                :options="authOptions"
              />
              <UiInput
                v-model="editForm.values.host"
                label="Host"
                :error="editForm.errors.value.host"
              />
              <UiInput
                v-model="editForm.values.port"
                label="SSH port"
                :error="editForm.errors.value.port"
              />
            </div>

            <UiInput
              v-if="editForm.values.authMethod === 'password'"
              v-model="editForm.values.password"
              label="Password"
              type="password"
              :error="editForm.errors.value.password"
            />

            <template v-else>
              <UiTextarea
                v-model="editForm.values.privateKey"
                label="Private key"
                :rows="5"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                :error="editForm.errors.value.privateKey"
              />
              <UiInput
                v-model="editForm.values.passphrase"
                label="Passphrase (optional)"
                type="password"
              />
            </template>
          </template>
        </template>

        <div class="flex items-center justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="editing = false">Cancel</UiButton>
          <UiButton type="submit" :loading="editForm.submitting.value">Save</UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard v-if="provisioning || provisioningSteps.length" title="Provisioning">
      <UiAlert v-if="provisioningError" variant="error">{{ provisioningError }}</UiAlert>

      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="step in provisioningSteps"
          :key="step.step"
          :title="step.detail"
          class="rounded px-2 py-0.5 text-xs font-medium"
          :class="step.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'"
        >
          {{ PROVISIONING_STEP_LABEL[step.step] }}
        </span>
        <span
          v-if="provisioning"
          class="inline-flex items-center gap-1.5 text-xs text-content-muted"
        >
          <Icon name="lucide:loader-circle" class="size-3.5 animate-spin" />
          Provisioning…
        </span>
      </div>
    </UiCard>

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

    <UiCard v-if="proxyContainer" title="Reverse proxy">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Reverse proxy</h2>
          <UiBadge variant="info">{{ proxyContainer.state }}</UiBadge>
        </div>
      </template>

      <div class="flex items-center justify-between gap-4">
        <p class="text-xs text-content-muted">
          Access log for every request routed through Caddy on this server — every domain and
          application share this stream.
        </p>
        <UiButton variant="ghost" @click="toggleProxyLogs">
          {{ proxyLogsOpen ? 'Hide logs' : 'View logs' }}
        </UiButton>
      </div>

      <UiAlert v-if="proxyError" variant="error" class="mt-3">{{ proxyError }}</UiAlert>

      <div v-if="proxyLogsOpen" class="mt-3 rounded-lg border border-surface-border bg-surface p-3">
        <p v-if="proxyLogsLoading" class="text-xs text-content-muted">Loading…</p>
        <p v-else-if="!proxyLogLines.length" class="text-xs text-content-muted">No log lines.</p>
        <pre v-else class="max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">{{
          proxyLogLines.map(line => line.message).join('\n')
        }}</pre>
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
