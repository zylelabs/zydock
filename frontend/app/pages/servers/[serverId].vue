<script setup lang="ts">
  import { z } from 'zod';
  import {
    useContainers,
    APPLICATION_LABEL,
    CONTAINER_STATES,
    type ContainerInfo,
    type ContainerLogEntry,
    type ContainerState,
  } from '~/composables/services/useContainers';
  import { useImages, type ImageInfo } from '~/composables/services/useImages';
  import {
    useMetrics,
    type MetricSample,
    type SystemMetrics,
  } from '~/composables/services/useMetrics';
  import { useNetworks, type NetworkInfo } from '~/composables/services/useNetworks';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import {
    useServers,
    type ProvisioningResult,
    type ProvisioningStepName,
    type SshCredentials,
  } from '~/composables/services/useServers';
  import { useVolumes, type VolumeInfo } from '~/composables/services/useVolumes';
  import { formatBytes } from '~/utils';

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const servers = useServers();
  const containersApi = useContainers();
  const imagesApi = useImages();
  const networksApi = useNetworks();
  const volumesApi = useVolumes();
  const metricsApi = useMetrics();
  const { subscribe } = useWebSocket();

  const serverId = computed(() => String(route.params.serverId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const busy = ref('');

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({
      title: 'Error',
      message: (error as { message?: string }).message || fallback,
    });
  };

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

  const editForm = useSchemaForm(
    editSchema,
    {
      name: '',
      changeSsh: false,
      host: '',
      port: '22',
      username: 'root',
      authMethod: 'password' as 'password' | 'privateKey',
      password: '',
      privateKey: '',
      passphrase: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

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

  const handleSaveEdit = editForm.submit(async values => {
    await servers.update(serverId.value, {
      name: values.name,
      ...(values.changeSsh ? { ssh: buildSsh(values) } : {}),
    });

    await refresh();
    editing.value = false;
  });

  const refreshing = ref(false);

  const handleRefreshServer = async () => {
    refreshing.value = true;

    try {
      const probe = await servers.refresh(serverId.value);

      if (!probe.reachable) {
        toast.error({
          title: 'Error',
          message: probe.error || 'The server is unreachable.',
        });
      }

      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to refresh the server.');
    } finally {
      refreshing.value = false;
    }
  };

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

  const canProvision = computed(
    () =>
      server.value?.type === 'ssh' &&
      ['pending', 'failed', 'offline'].includes(server.value.status),
  );

  const applyProvisioningStep = (incoming: ProvisioningResult) => {
    const index = provisioningSteps.value.findIndex(step => step.step === incoming.step);

    if (index === -1) {
      provisioningSteps.value.push(incoming);
      return;
    }

    provisioningSteps.value[index] = incoming;
  };

  const handleProvision = async () => {
    provisioningSteps.value = [];
    provisioning.value = true;

    const stop = subscribe(servers.provisioningTopic(serverId.value), message => {
      if (message.event === 'provisioning.step') {
        applyProvisioningStep(message.data as ProvisioningResult);
      }
    });

    try {
      const result = await servers.provision(serverId.value);

      provisioningSteps.value = result.steps;
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to provision the server.');
    } finally {
      provisioning.value = false;
      stop();
    }
  };

  const metrics = ref<SystemMetrics | null>(null);
  const history = ref<MetricSample[]>([]);

  const loadMetrics = async () => {
    try {
      metrics.value = await metricsApi.serverMetrics(serverId.value);
    } catch {
      metrics.value = null;
    }
  };

  const loadHistory = async () => {
    try {
      history.value = (await metricsApi.serverMetricsHistory(serverId.value, { limit: 50 })).items;
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

  const PROXY_CONTAINER_NAME = 'zydock-proxy';

  const proxyContainer = ref<ContainerInfo | null>(null);
  const proxyLogsOpen = ref(false);
  const proxyLogLines = ref<ContainerLogEntry[]>([]);
  const proxyLogsLoading = ref(false);

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

    try {
      proxyLogLines.value = await containersApi.logs(serverId.value, proxyContainer.value.id, 200);
    } catch (error) {
      proxyLogLines.value = [];
      notifyError(error, 'Failed to load the logs.');
    } finally {
      proxyLogsLoading.value = false;
    }
  };

  watch(serverId, loadProxyContainer, { immediate: true });

  type Tab = 'containers' | 'images' | 'networks' | 'volumes';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'containers', label: 'Containers' },
    { key: 'images', label: 'Images' },
    { key: 'networks', label: 'Networks' },
    { key: 'volumes', label: 'Volumes' },
  ];

  const activeTab = ref<Tab>('containers');
  const loadedTabs = new Set<Tab>();

  const containers = ref<ContainerInfo[]>([]);
  const containersLoading = ref(false);
  const stateFilter = ref<ContainerState | ''>('');
  const openLogs = ref('');
  const logLines = ref<ContainerLogEntry[]>([]);
  const logsLoading = ref(false);

  const loadContainers = async () => {
    containersLoading.value = true;

    try {
      containers.value = await containersApi.list(serverId.value, {
        state: stateFilter.value || undefined,
      });
    } catch (error) {
      containers.value = [];
      notifyError(error, 'Failed to list the containers.');
    } finally {
      containersLoading.value = false;
    }
  };

  watch(stateFilter, loadContainers);

  const ownerOf = (container: ContainerInfo) => container.labels?.[APPLICATION_LABEL];

  const handleContainerAction = async (
    container: ContainerInfo,
    action: 'start' | 'stop' | 'restart' | 'remove',
  ) => {
    busy.value = `${container.id}:${action}`;

    try {
      if (action === 'remove') {
        await containersApi.remove(serverId.value, container.id);
      } else {
        await containersApi[action](serverId.value, container.id);
      }

      await loadContainers();
    } catch (error) {
      notifyError(error, `Failed to ${action} the container.`);
    } finally {
      busy.value = '';
    }
  };

  const toggleLogs = async (container: ContainerInfo) => {
    if (openLogs.value === container.id) {
      openLogs.value = '';
      return;
    }

    openLogs.value = container.id;
    logsLoading.value = true;

    try {
      logLines.value = await containersApi.logs(serverId.value, container.id, 200);
    } catch (error) {
      logLines.value = [];
      notifyError(error, 'Failed to load the logs.');
    } finally {
      logsLoading.value = false;
    }
  };

  const images = ref<ImageInfo[]>([]);
  const imagesLoading = ref(false);
  const pullReference = ref('');
  const pulling = ref(false);

  const loadImages = async () => {
    imagesLoading.value = true;

    try {
      images.value = await imagesApi.list(serverId.value);
    } catch (error) {
      images.value = [];
      notifyError(error, 'Failed to list the images.');
    } finally {
      imagesLoading.value = false;
    }
  };

  const handlePull = async () => {
    if (!pullReference.value.trim()) {
      return;
    }

    pulling.value = true;

    try {
      await imagesApi.pull(serverId.value, pullReference.value.trim());
      pullReference.value = '';
      await loadImages();
    } catch (error) {
      notifyError(error, 'Failed to pull the image.');
    } finally {
      pulling.value = false;
    }
  };

  const handleRemoveImage = async (image: ImageInfo) => {
    busy.value = `${image.id}:remove`;

    try {
      await imagesApi.remove(serverId.value, image.tag);
      await loadImages();
    } catch (error) {
      notifyError(error, 'Failed to remove the image.');
    } finally {
      busy.value = '';
    }
  };

  const networks = ref<NetworkInfo[]>([]);
  const networksLoading = ref(false);
  const newNetworkName = ref('');
  const creatingNetwork = ref(false);

  const loadNetworks = async () => {
    networksLoading.value = true;

    try {
      networks.value = await networksApi.list(serverId.value);
    } catch (error) {
      networks.value = [];
      notifyError(error, 'Failed to list the networks.');
    } finally {
      networksLoading.value = false;
    }
  };

  const handleCreateNetwork = async () => {
    if (!newNetworkName.value.trim()) {
      return;
    }

    creatingNetwork.value = true;

    try {
      await networksApi.create(serverId.value, newNetworkName.value.trim());
      newNetworkName.value = '';
      await loadNetworks();
    } catch (error) {
      notifyError(error, 'Failed to create the network.');
    } finally {
      creatingNetwork.value = false;
    }
  };

  const handleRemoveNetwork = async (network: NetworkInfo) => {
    busy.value = `${network.id}:remove`;

    try {
      await networksApi.remove(serverId.value, network.name);
      await loadNetworks();
    } catch (error) {
      notifyError(error, 'Failed to remove the network.');
    } finally {
      busy.value = '';
    }
  };

  const volumes = ref<VolumeInfo[]>([]);
  const volumesLoading = ref(false);
  const newVolumeName = ref('');
  const creatingVolume = ref(false);

  const loadVolumes = async () => {
    volumesLoading.value = true;

    try {
      volumes.value = await volumesApi.list(serverId.value);
    } catch (error) {
      volumes.value = [];
      notifyError(error, 'Failed to list the volumes.');
    } finally {
      volumesLoading.value = false;
    }
  };

  const handleCreateVolume = async () => {
    if (!newVolumeName.value.trim()) {
      return;
    }

    creatingVolume.value = true;

    try {
      await volumesApi.create(serverId.value, newVolumeName.value.trim());
      newVolumeName.value = '';
      await loadVolumes();
    } catch (error) {
      notifyError(error, 'Failed to create the volume.');
    } finally {
      creatingVolume.value = false;
    }
  };

  const handleRemoveVolume = async (volume: VolumeInfo) => {
    busy.value = `${volume.name}:remove`;

    try {
      await volumesApi.remove(serverId.value, volume.name);
      await loadVolumes();
    } catch (error) {
      notifyError(error, 'Failed to remove the volume.');
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
        return;
      }

      if (tab === 'images') {
        loadImages();
        return;
      }

      if (tab === 'networks') {
        loadNetworks();
        return;
      }

      loadVolumes();
    },
    { immediate: true },
  );

  const stateOptions = [
    { value: '', label: 'All states' },
    ...CONTAINER_STATES.map(state => ({ value: state, label: state })),
  ];
</script>

<template>
  <Content v-if="server">
    <NuxtLink
      to="/servers"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Servers
    </NuxtLink>

    <Header :title="server.name">
      <template #right>
        <div class="flex flex-wrap items-center gap-2">
          <Tag v-if="server.type === 'local'">local</Tag>
          <Tag :color="server.online ? 'green' : 'yellow'">
            {{ server.online ? 'online' : 'offline' }}
          </Tag>

          <template v-if="canManage">
            <Button theme="ghost" type="button" @click="openEdit">
              <Icon name="lucide:pencil" size="16" />
              Edit
            </Button>
            <Button
              v-if="server.type === 'ssh'"
              theme="ghost"
              type="button"
              :disabled="refreshing"
              @click="handleRefreshServer"
            >
              <Icon v-if="refreshing" name="svg-spinners:tadpole" size="16" />
              Refresh
            </Button>
            <Button
              v-if="canProvision"
              theme="secondary"
              type="button"
              :disabled="provisioning"
              @click="handleProvision"
            >
              <Icon v-if="provisioning" name="svg-spinners:tadpole" size="16" />
              Provision
            </Button>
          </template>
        </div>
      </template>
    </Header>

    <div class="flex flex-col gap-6">
      <Card v-if="editing" title="Edit server">
        <form class="flex flex-col gap-4" @submit.prevent="handleSaveEdit">
          <Input
            v-model="editForm.values.name"
            label="Name"
            :call-error="editForm.errors.value.name"
          />

          <template v-if="server.type === 'ssh'">
            <Switch v-model="editForm.values.changeSsh" label="Change SSH credentials" />

            <template v-if="editForm.values.changeSsh">
              <div class="grid gap-4 sm:grid-cols-2">
                <Input
                  v-model="editForm.values.username"
                  label="SSH user"
                  :call-error="editForm.errors.value.username"
                />
                <Select
                  v-model="editForm.values.authMethod"
                  label="Authentication"
                  :options="authOptions"
                />
                <Input
                  v-model="editForm.values.host"
                  label="Host"
                  :call-error="editForm.errors.value.host"
                />
                <Input
                  v-model="editForm.values.port"
                  label="SSH port"
                  :call-error="editForm.errors.value.port"
                />
              </div>

              <Input
                v-if="editForm.values.authMethod === 'password'"
                v-model="editForm.values.password"
                label="Password"
                password
                :call-error="editForm.errors.value.password"
              />

              <template v-else>
                <Input
                  v-model="editForm.values.privateKey"
                  label="Private key"
                  type="textarea"
                  :rows="5"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  :call-error="editForm.errors.value.privateKey"
                />
                <Input
                  v-model="editForm.values.passphrase"
                  label="Passphrase (optional)"
                  password
                />
              </template>
            </template>
          </template>

          <div class="flex items-center justify-end gap-2">
            <Button theme="ghost" type="button" @click="editing = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="editForm.loading.value">
              <Icon v-if="editForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card v-if="provisioning || provisioningSteps.length" title="Provisioning">
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
            <Icon name="svg-spinners:tadpole" size="14" />
            Provisioning…
          </span>
        </div>
      </Card>

      <Card title="Metrics">
        <p v-if="!metrics" class="text-sm text-content-muted">Metrics unavailable.</p>

        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <div class="mb-1 flex justify-between text-xs text-content-muted">
                <span>CPU</span>
                <span>{{ Math.round(metrics.cpuPercent ?? 0) }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
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
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  class="h-full bg-primary"
                  :style="{ width: `${percent(metrics.memoryUsedMb, metrics.memoryTotalMb)}%` }"
                />
              </div>
            </div>
          </div>

          <p class="mt-3 text-xs text-content-muted">
            {{ metrics.containersRunning }} of {{ metrics.containersTotal }} containers running ·
            disk {{ percent(metrics.diskUsedGb, metrics.diskTotalGb) }}%
          </p>

          <div
            v-if="chronological.length"
            class="mt-4 flex flex-col gap-3 border-t border-surface-line pt-4"
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
        </template>
      </Card>

      <Card v-if="proxyContainer" title="Reverse proxy">
        <template #right>
          <div class="flex items-center gap-2">
            <Tag color="blue">{{ proxyContainer.state }}</Tag>
            <Button theme="ghost" @click="toggleProxyLogs">
              {{ proxyLogsOpen ? 'Hide logs' : 'View logs' }}
            </Button>
          </div>
        </template>

        <p class="text-xs text-content-muted">
          Access log for every request routed through Caddy on this server — every domain and
          application share this stream.
        </p>

        <div
          v-if="proxyLogsOpen"
          class="mt-3 rounded-lg border border-surface-border bg-surface-sunken p-3"
        >
          <p v-if="proxyLogsLoading" class="text-xs text-content-muted">Loading…</p>
          <p v-else-if="!proxyLogLines.length" class="text-xs text-content-muted">No log lines.</p>
          <pre v-else class="max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">{{
            proxyLogLines.map(line => line.message).join('\n')
          }}</pre>
        </div>
      </Card>

      <div class="flex gap-1 border-b border-surface-line">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            activeTab === tab.key
              ? 'border-primary text-content-strong'
              : 'border-transparent text-content-muted hover:text-content-strong'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <Card v-if="activeTab === 'containers'" title="Containers">
        <template #right>
          <div class="w-44">
            <Select v-model="stateFilter" :options="stateOptions" />
          </div>
        </template>

        <p v-if="containersLoading" class="text-sm text-content-muted">Loading…</p>
        <p v-else-if="!containers.length" class="text-sm text-content-muted">
          No containers found.
        </p>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="container in containers"
            :key="container.id"
            class="rounded-xl border border-surface-border bg-surface-sunken p-4"
          >
            <div class="flex flex-wrap items-center gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="truncate text-content-strong">{{ container.name }}</h3>
                  <Tag color="blue">{{ container.state }}</Tag>
                  <Tag v-if="ownerOf(container)">app-managed</Tag>
                </div>
                <p class="mt-1 truncate text-xs text-content-muted">{{ container.image }}</p>
                <p class="mt-1 truncate text-xs text-content-muted">
                  restarts: {{ container.restartCount }}
                  <span v-if="container.exitCode !== undefined">
                    · exit {{ container.exitCode }}
                  </span>
                </p>
              </div>

              <div v-if="canManage" class="flex flex-wrap items-center gap-2">
                <Button theme="ghost" @click="toggleLogs(container)">Logs</Button>
                <Button
                  v-if="container.state !== 'running'"
                  theme="secondary"
                  :disabled="busy === `${container.id}:start`"
                  @click="handleContainerAction(container, 'start')"
                >
                  <Icon
                    v-if="busy === `${container.id}:start`"
                    name="svg-spinners:tadpole"
                    size="16"
                  />
                  Start
                </Button>
                <Button
                  v-else
                  theme="secondary"
                  :disabled="busy === `${container.id}:stop`"
                  @click="handleContainerAction(container, 'stop')"
                >
                  <Icon
                    v-if="busy === `${container.id}:stop`"
                    name="svg-spinners:tadpole"
                    size="16"
                  />
                  Stop
                </Button>
                <Button
                  theme="secondary"
                  :disabled="busy === `${container.id}:restart`"
                  @click="handleContainerAction(container, 'restart')"
                >
                  <Icon
                    v-if="busy === `${container.id}:restart`"
                    name="svg-spinners:tadpole"
                    size="16"
                  />
                  Restart
                </Button>
                <button
                  type="button"
                  title="Remove container"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
                  @click="handleContainerAction(container, 'remove')"
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
      </Card>

      <Card v-if="activeTab === 'images'" title="Images">
        <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="handlePull">
          <Input v-model="pullReference" class="flex-1" placeholder="nginx:latest" compact />
          <Button theme="secondary" type="submit" :disabled="pulling">
            <Icon v-if="pulling" name="svg-spinners:tadpole" size="16" />
            Pull
          </Button>
        </form>

        <p v-if="imagesLoading" class="text-sm text-content-muted">Loading…</p>
        <p v-else-if="!images.length" class="text-sm text-content-muted">No images found.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="image in images" :key="image.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">{{ image.tag }}</p>
              <p class="truncate text-xs text-content-muted">{{ formatBytes(image.sizeBytes) }}</p>
            </div>
            <button
              v-if="canManage"
              type="button"
              title="Remove image"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
              @click="handleRemoveImage(image)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </li>
        </ul>
      </Card>

      <Card v-if="activeTab === 'networks'" title="Networks">
        <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="handleCreateNetwork">
          <Input v-model="newNetworkName" class="flex-1" placeholder="my-network" compact />
          <Button theme="secondary" type="submit" :disabled="creatingNetwork">
            <Icon v-if="creatingNetwork" name="svg-spinners:tadpole" size="16" />
            Create
          </Button>
        </form>

        <p v-if="networksLoading" class="text-sm text-content-muted">Loading…</p>
        <p v-else-if="!networks.length" class="text-sm text-content-muted">No networks found.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="network in networks" :key="network.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">{{ network.name }}</p>
              <p class="truncate text-xs text-content-muted">{{ network.driver }}</p>
            </div>
            <button
              v-if="canManage"
              type="button"
              title="Remove network"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
              @click="handleRemoveNetwork(network)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </li>
        </ul>
      </Card>

      <Card v-if="activeTab === 'volumes'" title="Volumes">
        <form v-if="canManage" class="mb-4 flex gap-2" @submit.prevent="handleCreateVolume">
          <Input v-model="newVolumeName" class="flex-1" placeholder="my-volume" compact />
          <Button theme="secondary" type="submit" :disabled="creatingVolume">
            <Icon v-if="creatingVolume" name="svg-spinners:tadpole" size="16" />
            Create
          </Button>
        </form>

        <p v-if="volumesLoading" class="text-sm text-content-muted">Loading…</p>
        <p v-else-if="!volumes.length" class="text-sm text-content-muted">No volumes found.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="volume in volumes" :key="volume.name" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-content-strong">{{ volume.name }}</p>
              <p class="truncate text-xs text-content-muted">{{ volume.mountpoint }}</p>
            </div>
            <button
              v-if="canManage"
              type="button"
              title="Remove volume"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
              @click="handleRemoveVolume(volume)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </li>
        </ul>
      </Card>
    </div>
  </Content>
</template>
