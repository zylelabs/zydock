<script setup lang="ts">
  import { z } from 'zod';
  import type { ApplicationStatus, ApplicationVariable } from '~/composables/use-applications';
  import type { Deployment, DeploymentStatus } from '~/composables/use-deployments';
  import type { Domain, DomainStatus } from '~/composables/use-domains';

  const route = useRoute();
  const session = useSessionStore();
  const applicationId = computed(() => String(route.params.applicationId));

  const { current } = useOrganizations();
  const applications = useApplications();
  const deployments = useDeployments();
  const domains = useDomains();
  const metricsApi = useMetrics();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');

  const { data, refresh } = await useAsyncData(
    () => `application-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [app, deps, vars, doms, metrics, deployMetrics] = await Promise.all([
        applications.get(applicationId.value),
        deployments.list({ applicationId: applicationId.value }),
        applications.listVariables(applicationId.value).catch(() => ({ variables: [] })),
        domains.list({ applicationId: applicationId.value }).catch(() => ({ items: [] })),
        metricsApi.applicationMetrics(applicationId.value).catch(() => null),
        metricsApi.applicationDeploymentMetrics(applicationId.value).catch(() => null),
      ]);

      return {
        application: app.application,
        deployments: deps.items,
        variables: vars.variables,
        domains: doms.items,
        metrics,
        deployMetrics,
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );

  useHead(() => ({ title: data.value?.application.name ?? 'Application' }));

  const application = computed(() => data.value?.application ?? null);
  const deploymentList = computed(() => data.value?.deployments ?? []);
  const runningDeployment = computed(() =>
    deploymentList.value.find(
      deployment => deployment.status === 'queued' || deployment.status === 'running',
    ),
  );

  const APP_STATUS: Record<
    ApplicationStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    created: { label: 'Created', variant: 'neutral' },
    deploying: { label: 'Deploying', variant: 'info' },
    running: { label: 'Running', variant: 'success' },
    stopped: { label: 'Stopped', variant: 'warning' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const DEPLOY_STATUS: Record<
    DeploymentStatus,
    'neutral' | 'success' | 'warning' | 'danger' | 'info'
  > = {
    queued: 'neutral',
    running: 'info',
    succeeded: 'success',
    failed: 'danger',
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const metrics = computed(() => data.value?.metrics ?? null);
  const deployMetrics = computed(() => data.value?.deployMetrics ?? null);
  const memoryPercent = computed(() => {
    const value = metrics.value;

    return value?.memoryLimitMb ? Math.round((value.memoryUsedMb / value.memoryLimitMb) * 100) : 0;
  });

  const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'] as const;
  const restartOptions = RESTART_POLICIES.map(value => ({ value, label: value }));

  const editingConfig = ref(false);

  const configForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      repository: z
        .string()
        .trim()
        .regex(/^[^/\s]+\/[^/\s]+$/, 'Use the owner/repository format'),
      branch: z.string().trim().min(1, 'Enter the branch'),
      dockerfilePath: z.string().trim().min(1, 'Enter the Dockerfile'),
      buildContext: z.string().trim().min(1, 'Enter the build context'),
      port: z.string().regex(/^\d+$/, 'Invalid port'),
      autoDeploy: z.boolean(),
      restartPolicy: z.enum(RESTART_POLICIES),
    }),
    {
      name: '',
      repository: '',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
      port: '3000',
      autoDeploy: true,
      restartPolicy: 'unless-stopped' as (typeof RESTART_POLICIES)[number],
    },
  );

  const startEditConfig = () => {
    const app = data.value?.application;

    if (!app) {
      return;
    }

    configForm.values.name = app.name;
    configForm.values.repository = app.git.repository;
    configForm.values.branch = app.git.branch;
    configForm.values.dockerfilePath = app.git.dockerfilePath;
    configForm.values.buildContext = app.git.buildContext;
    configForm.values.port = String(app.port);
    configForm.values.autoDeploy = app.git.autoDeploy;
    configForm.values.restartPolicy = app.restartPolicy as (typeof RESTART_POLICIES)[number];
    editingConfig.value = true;
  };

  const onSaveConfig = configForm.submit(async values => {
    await applications.update(applicationId.value, {
      name: values.name,
      port: Number(values.port),
      restartPolicy: values.restartPolicy,
      // Dotted paths on the backend keep the token intact even when git is patched.
      git: {
        repository: values.repository,
        branch: values.branch,
        dockerfilePath: values.dockerfilePath,
        buildContext: values.buildContext,
        autoDeploy: values.autoDeploy,
      },
    });
    editingConfig.value = false;
    await refresh();
  });

  // --- Deploy ------------------------------------------------------------------------------------

  const deploying = ref(false);

  const triggerDeploy = async () => {
    actionError.value = '';
    deploying.value = true;

    try {
      // Straight to the live log of the deploy just started.
      const { deployment } = await applications.deploy(applicationId.value);

      await navigateTo(`/applications/${applicationId.value}/deployments/${deployment.id}`);
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to start the deployment.';
    } finally {
      deploying.value = false;
    }
  };

  // --- Rollback ----------------------------------------------------------------------------------

  const rollbackTarget = ref<Deployment | null>(null);
  const rollingBack = ref(false);

  const confirmRollback = async () => {
    if (!rollbackTarget.value) {
      return;
    }

    rollingBack.value = true;
    actionError.value = '';

    try {
      const { deployment } = await applications.rollback(
        applicationId.value,
        rollbackTarget.value.id,
      );

      rollbackTarget.value = null;
      // Straight to the live log of the rollback deploy.
      await navigateTo(`/applications/${applicationId.value}/deployments/${deployment.id}`);
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to roll back.';
    } finally {
      rollingBack.value = false;
    }
  };

  // --- Lifecycle (restart / stop / start) -----------------------------------------------

  const lifecycleBusy = ref('');

  const runLifecycle = async (action: 'restart' | 'stop' | 'start') => {
    actionError.value = '';
    lifecycleBusy.value = action;

    try {
      await applications[action](applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'The operation failed.';
    } finally {
      lifecycleBusy.value = '';
    }
  };

  // --- Network (port mappings) ------------------------------------------------------------

  type PortDraft = { hostPort: string; containerPort: string; protocol: 'tcp' | 'udp' };

  const protocolOptions = [
    { value: 'tcp', label: 'tcp' },
    { value: 'udp', label: 'udp' },
  ];

  const editingPorts = ref(false);
  const portDraft = ref<PortDraft[]>([]);
  const savingPorts = ref(false);
  const portError = ref('');

  const startEditPorts = () => {
    portDraft.value = (application.value?.portMappings ?? []).map(mapping => ({
      hostPort: String(mapping.hostPort),
      containerPort: String(mapping.containerPort),
      protocol: mapping.protocol,
    }));
    portError.value = '';
    editingPorts.value = true;
  };

  const addPort = () => portDraft.value.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
  const removePort = (index: number) => portDraft.value.splice(index, 1);

  const isPort = (value: string) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

  const savePorts = async () => {
    const rows = portDraft.value.filter(row => row.hostPort.trim() || row.containerPort.trim());

    if (!rows.every(row => isPort(row.hostPort) && isPort(row.containerPort))) {
      portError.value = 'Enter valid ports (1–65535) for host and container.';
      return;
    }

    portError.value = '';
    savingPorts.value = true;

    try {
      await applications.update(applicationId.value, {
        portMappings: rows.map(row => ({
          hostPort: Number(row.hostPort),
          containerPort: Number(row.containerPort),
          protocol: row.protocol,
        })),
      });
      editingPorts.value = false;
      await refresh();
    } catch (error) {
      portError.value = (error as { message?: string }).message || 'Failed to save the ports.';
    } finally {
      savingPorts.value = false;
    }
  };

  // --- Advanced (volumes, networks, healthcheck, recursos) --------------------------------------

  const editingAdv = ref(false);
  const savingAdv = ref(false);
  const advError = ref('');

  const advDraft = reactive({
    volumes: [] as { source: string; target: string; readOnly: boolean }[],
    networks: [] as string[],
    healthcheckEnabled: false,
    hcPath: '/',
    hcInterval: '30',
    hcTimeout: '5',
    hcRetries: '3',
    hcStartPeriod: '',
    cpus: '',
    memoryMb: '',
  });

  const startEditAdv = () => {
    const app = application.value;

    if (!app) {
      return;
    }

    advDraft.volumes = app.volumes.map(volume => ({
      source: volume.source,
      target: volume.target,
      readOnly: Boolean(volume.readOnly),
    }));
    advDraft.networks = [...app.networks];
    advDraft.healthcheckEnabled = Boolean(app.healthcheck?.path);
    advDraft.hcPath = app.healthcheck?.path ?? '/';
    advDraft.hcInterval = String(app.healthcheck?.intervalSeconds ?? 30);
    advDraft.hcTimeout = String(app.healthcheck?.timeoutSeconds ?? 5);
    advDraft.hcRetries = String(app.healthcheck?.retries ?? 3);
    advDraft.hcStartPeriod =
      app.healthcheck?.startPeriodSeconds != null ? String(app.healthcheck.startPeriodSeconds) : '';
    advDraft.cpus = app.resources?.cpus != null ? String(app.resources.cpus) : '';
    advDraft.memoryMb = app.resources?.memoryMb != null ? String(app.resources.memoryMb) : '';
    advError.value = '';
    editingAdv.value = true;
  };

  const addVolume = () => advDraft.volumes.push({ source: '', target: '', readOnly: false });
  const removeVolume = (index: number) => advDraft.volumes.splice(index, 1);
  const addNetwork = () => advDraft.networks.push('');
  const removeNetwork = (index: number) => advDraft.networks.splice(index, 1);

  const saveAdv = async () => {
    const volumes = advDraft.volumes.filter(volume => volume.source.trim() || volume.target.trim());

    if (!volumes.every(volume => volume.source.trim() && volume.target.trim().startsWith('/'))) {
      advError.value = 'Each volume needs a source and a target starting with "/".';
      return;
    }

    if (advDraft.cpus.trim() && !(Number(advDraft.cpus) > 0)) {
      advError.value = 'CPUs must be a positive number.';
      return;
    }

    if (
      advDraft.memoryMb.trim() &&
      !(/^\d+$/.test(advDraft.memoryMb.trim()) && Number(advDraft.memoryMb) > 0)
    ) {
      advError.value = 'Memory (MB) must be a positive integer.';
      return;
    }

    const body: Record<string, unknown> = {
      volumes: volumes.map(volume => ({
        source: volume.source.trim(),
        target: volume.target.trim(),
        readOnly: volume.readOnly,
      })),
      networks: advDraft.networks.map(network => network.trim()).filter(Boolean),
      resources: {
        ...(advDraft.cpus.trim() ? { cpus: Number(advDraft.cpus) } : {}),
        ...(advDraft.memoryMb.trim() ? { memoryMb: Number(advDraft.memoryMb) } : {}),
      },
    };

    if (advDraft.healthcheckEnabled) {
      if (!advDraft.hcPath.trim().startsWith('/')) {
        advError.value = 'The healthcheck path must start with "/".';
        return;
      }

      body.healthcheck = {
        path: advDraft.hcPath.trim(),
        intervalSeconds: Number(advDraft.hcInterval) || 30,
        timeoutSeconds: Number(advDraft.hcTimeout) || 5,
        retries: Number(advDraft.hcRetries) || 3,
        ...(advDraft.hcStartPeriod.trim()
          ? { startPeriodSeconds: Number(advDraft.hcStartPeriod) }
          : {}),
      };
    } else {
      // `null` removes the healthcheck on the backend.
      body.healthcheck = null;
    }

    advError.value = '';
    savingAdv.value = true;

    try {
      await applications.update(applicationId.value, body);
      editingAdv.value = false;
      await refresh();
    } catch (error) {
      advError.value = (error as { message?: string }).message || 'Failed to save.';
    } finally {
      savingAdv.value = false;
    }
  };

  // --- Domains ----------------------------------------------------------------------------------

  const domainList = computed(() => data.value?.domains ?? []);

  const DOMAIN_STATUS: Record<
    DomainStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    pending: { label: 'Pending', variant: 'warning' },
    active: { label: 'Active', variant: 'success' },
    error: { label: 'Error', variant: 'danger' },
  };

  const addingDomain = ref(false);
  const domainBusy = ref('');

  const domainForm = useForm(
    z.object({
      hostname: z.string().trim().min(1, 'Enter the domain'),
      pathPrefix: z.string().trim().optional(),
      tls: z.boolean(),
    }),
    { hostname: '', pathPrefix: '', tls: true },
  );

  const openAddDomain = () => {
    domainForm.reset();
    addingDomain.value = true;
  };

  const onCreateDomain = domainForm.submit(async values => {
    await domains.create({
      applicationId: applicationId.value,
      hostname: values.hostname,
      pathPrefix: values.pathPrefix || undefined,
      tls: values.tls,
    });
    addingDomain.value = false;
    await refresh();
  });

  const runDomainAction = async (domain: Domain, action: 'apply' | 'renew') => {
    actionError.value = '';
    domainBusy.value = `${domain.id}:${action}`;

    try {
      await domains[action](domain.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'The operation failed.';
    } finally {
      domainBusy.value = '';
    }
  };

  const domainToRemove = ref<Domain | null>(null);
  const removingDomain = ref(false);

  const confirmRemoveDomain = async () => {
    if (!domainToRemove.value) {
      return;
    }

    removingDomain.value = true;
    actionError.value = '';

    try {
      await domains.remove(domainToRemove.value.id);
      await refresh();
      domainToRemove.value = null;
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove.';
    } finally {
      removingDomain.value = false;
    }
  };

  // --- Variables ---------------------------------------------------------------------------------

  const editingVars = ref(false);
  const draft = ref<ApplicationVariable[]>([]);
  const savingVars = ref(false);

  const startEditVars = () => {
    draft.value = (data.value?.variables ?? []).map(variable => ({ ...variable }));
    editingVars.value = true;
  };

  const addVar = () => draft.value.push({ key: '', value: '', secret: false });
  const removeVar = (index: number) => draft.value.splice(index, 1);

  const saveVars = async () => {
    actionError.value = '';
    savingVars.value = true;

    try {
      await applications.replaceVariables(
        applicationId.value,
        draft.value.filter(variable => variable.key.trim()),
      );
      editingVars.value = false;
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to save the variables.';
    } finally {
      savingVars.value = false;
    }
  };

  // --- Access token (private repository) -----------------------------------------------------

  const editingToken = ref(false);
  const tokenDraft = ref('');
  const savingToken = ref(false);

  const startEditToken = () => {
    tokenDraft.value = '';
    editingToken.value = true;
  };

  // `null` clears the token; a string sets or replaces it.
  const saveToken = async (token: string | null) => {
    actionError.value = '';
    savingToken.value = true;

    try {
      await applications.update(applicationId.value, { git: { token } });
      editingToken.value = false;
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to save the token.';
    } finally {
      savingToken.value = false;
    }
  };

  // --- Git webhook (auto-deploy) ------------------------------------------------------------------

  const webhookBusy = ref(false);
  const webhookCopied = ref(false);

  const onConfigureWebhook = async () => {
    actionError.value = '';
    webhookBusy.value = true;

    try {
      await applications.configureWebhook(applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to configure the webhook.';
    } finally {
      webhookBusy.value = false;
    }
  };

  const onRemoveWebhook = async () => {
    actionError.value = '';
    webhookBusy.value = true;

    try {
      await applications.removeWebhook(applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to remove the webhook.';
    } finally {
      webhookBusy.value = false;
    }
  };

  const copyWebhookUrl = async () => {
    if (!application.value?.git.webhookUrl) {
      return;
    }

    await navigator.clipboard.writeText(application.value.git.webhookUrl);
    webhookCopied.value = true;
    setTimeout(() => (webhookCopied.value = false), 2000);
  };

  // --- Danger zone (delete application) -----------------------------------------------------------

  const confirmDeleteOpen = ref(false);
  const deletingApp = ref(false);

  const onDeleteApplication = async () => {
    actionError.value = '';
    deletingApp.value = true;

    try {
      const projectId = application.value?.projectId;

      await applications.remove(applicationId.value);
      await navigateTo(projectId ? `/projects/${projectId}` : '/projects');
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to delete the application.';
      deletingApp.value = false;
    }
  };
</script>

<template>
  <section v-if="application" class="mx-auto flex max-w-4xl flex-col gap-6">
    <NuxtLink
      :to="`/projects/${application.projectId}`"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Project
    </NuxtLink>

    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h1>{{ application.name }}</h1>
        <UiBadge :variant="APP_STATUS[application.status].variant">
          {{ APP_STATUS[application.status].label }}
        </UiBadge>
      </div>

      <div class="flex items-center gap-2">
        <NuxtLink
          :to="`/applications/${application.id}/logs`"
          class="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-content-muted transition-colors hover:text-content"
        >
          <Icon name="lucide:scroll-text" class="size-4" />
          Logs
        </NuxtLink>
        <NuxtLink
          :to="`/applications/${application.id}/console`"
          class="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-content-muted transition-colors hover:text-content"
        >
          <Icon name="lucide:square-terminal" class="size-4" />
          Console
        </NuxtLink>
        <template v-if="canManage">
          <UiButton
            v-if="application.status === 'running'"
            variant="secondary"
            :loading="lifecycleBusy === 'stop'"
            @click="runLifecycle('stop')"
          >
            <Icon name="lucide:square" class="size-4" />
            Stop
          </UiButton>
          <UiButton
            v-else-if="application.status === 'stopped'"
            variant="secondary"
            :loading="lifecycleBusy === 'start'"
            @click="runLifecycle('start')"
          >
            <Icon name="lucide:play" class="size-4" />
            Start
          </UiButton>
          <UiButton
            v-if="application.status === 'running'"
            variant="secondary"
            :loading="lifecycleBusy === 'restart'"
            @click="runLifecycle('restart')"
          >
            <Icon name="lucide:rotate-cw" class="size-4" />
            Restart
          </UiButton>
          <UiButton :loading="deploying" @click="triggerDeploy">
            <Icon name="lucide:rocket" class="size-4" />
            {{ deploymentList.length ? 'Redeploy' : 'Deploy' }}
          </UiButton>
        </template>
      </div>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>
    <UiAlert v-if="application.lastError" variant="error">{{ application.lastError }}</UiAlert>

    <NuxtLink
      v-if="runningDeployment"
      :to="`/applications/${application.id}/deployments/${runningDeployment.id}`"
      class="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary transition-colors hover:bg-primary/15"
    >
      <Icon name="lucide:loader" class="size-4 animate-spin" />
      Deployment in progress — view live logs
    </NuxtLink>

    <UiCard v-if="metrics || (deployMetrics && deployMetrics.window)" title="Resources">
      <div v-if="metrics" class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <UiBadge variant="info">{{ metrics.state }}</UiBadge>
          <UiBadge
            v-if="metrics.health !== 'none'"
            :variant="metrics.health === 'healthy' ? 'success' : 'warning'"
          >
            {{ metrics.health }}
          </UiBadge>
          <span class="text-xs text-content-muted">restarts: {{ metrics.restartCount }}</span>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <div class="mb-1 flex justify-between text-xs text-content-muted">
              <span>CPU</span><span>{{ Math.round(metrics.cpuPercent) }}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface">
              <div
                class="h-full bg-primary"
                :style="{ width: `${Math.min(100, metrics.cpuPercent)}%` }"
              />
            </div>
          </div>
          <div>
            <div class="mb-1 flex justify-between text-xs text-content-muted">
              <span>Memory</span>
              <span>{{ metrics.memoryUsedMb }} / {{ metrics.memoryLimitMb }} MB</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface">
              <div class="h-full bg-primary" :style="{ width: `${memoryPercent}%` }" />
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="deployMetrics && deployMetrics.window"
        class="grid gap-3 pt-4 text-sm sm:grid-cols-3"
        :class="metrics && 'mt-4 border-t border-surface-border'"
      >
        <div>
          <p class="text-xs text-content-muted">Success rate</p>
          <p class="font-medium">{{ deployMetrics.successRate }}%</p>
        </div>
        <div>
          <p class="text-xs text-content-muted">Avg. duration</p>
          <p class="font-medium">
            {{ formatDuration(deployMetrics.averageDurationMs ?? undefined) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-content-muted">Avg. build time</p>
          <p class="font-medium">{{ formatDuration(deployMetrics.averageBuildMs ?? undefined) }}</p>
        </div>
      </div>
    </UiCard>

    <UiCard title="Configuration">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Configuration</h2>
          <UiButton v-if="canManage && !editingConfig" variant="secondary" @click="startEditConfig">
            Edit
          </UiButton>
        </div>
      </template>

      <dl v-if="!editingConfig" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Repository</dt>
          <dd class="truncate">{{ application.git.repository }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Branch</dt>
          <dd>{{ application.git.branch }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Dockerfile</dt>
          <dd class="truncate">{{ application.git.dockerfilePath }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Build context</dt>
          <dd class="truncate">{{ application.git.buildContext }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Port</dt>
          <dd>{{ application.port }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Auto-deploy</dt>
          <dd>{{ application.git.autoDeploy ? 'Yes' : 'No' }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Restart policy</dt>
          <dd>{{ application.restartPolicy }}</dd>
        </div>
      </dl>

      <form v-else class="flex flex-col gap-4" @submit.prevent="onSaveConfig">
        <UiAlert v-if="configForm.formError.value" variant="error">
          {{ configForm.formError.value }}
        </UiAlert>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="configForm.values.name"
            label="Name"
            :error="configForm.errors.value.name"
          />
          <UiInput
            v-model="configForm.values.repository"
            label="Repository (GitHub)"
            placeholder="owner/repository"
            :error="configForm.errors.value.repository"
          />
          <UiInput
            v-model="configForm.values.branch"
            label="Branch"
            :error="configForm.errors.value.branch"
          />
          <UiInput
            v-model="configForm.values.dockerfilePath"
            label="Dockerfile"
            :error="configForm.errors.value.dockerfilePath"
          />
          <UiInput
            v-model="configForm.values.buildContext"
            label="Build context"
            :error="configForm.errors.value.buildContext"
          />
          <UiInput
            v-model="configForm.values.port"
            label="Port"
            :error="configForm.errors.value.port"
          />
          <UiSelect
            v-model="configForm.values.restartPolicy"
            label="Restart policy"
            :options="restartOptions"
          />
        </div>

        <UiCheckbox v-model="configForm.values.autoDeploy" label="Auto-deploy on every push" />

        <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="editingConfig = false">Cancel</UiButton>
          <UiButton type="submit" :loading="configForm.submitting.value">Save</UiButton>
        </div>
      </form>
    </UiCard>

    <!-- Domains -->
    <UiCard v-if="canManage" title="Domains">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Domains</h2>
          <UiButton v-if="!addingDomain" variant="secondary" @click="openAddDomain">
            <Icon name="lucide:plus" class="size-4" />
            Add
          </UiButton>
        </div>
      </template>

      <form
        v-if="addingDomain"
        class="mb-4 flex flex-col gap-4 rounded-lg border border-surface-border p-4"
        @submit.prevent="onCreateDomain"
      >
        <UiAlert v-if="domainForm.formError.value" variant="error">
          {{ domainForm.formError.value }}
        </UiAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="domainForm.values.hostname"
            label="Domain"
            placeholder="app.example.com"
            :error="domainForm.errors.value.hostname"
          />
          <UiInput
            v-model="domainForm.values.pathPrefix"
            label="Path prefix (optional)"
            placeholder="/api"
          />
        </div>
        <UiCheckbox v-model="domainForm.values.tls" label="Automatic HTTPS (Let's Encrypt)" />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="addingDomain = false">Cancel</UiButton>
          <UiButton type="submit" :loading="domainForm.submitting.value">Add</UiButton>
        </div>
      </form>

      <p v-if="!domainList.length" class="text-sm text-content-muted">
        No domains yet. Add one to publish this application on its own address.
      </p>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="domain in domainList"
          :key="domain.id"
          class="flex flex-wrap items-center gap-4 rounded-lg border border-surface-border p-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <Icon v-if="domain.tls" name="lucide:lock" class="size-4 text-success" />
              <span class="truncate font-medium">{{ domain.hostname }}{{ domain.pathPrefix }}</span>
              <UiBadge :variant="DOMAIN_STATUS[domain.status].variant">
                {{ DOMAIN_STATUS[domain.status].label }}
              </UiBadge>
            </div>
            <p v-if="domain.lastError" class="mt-1 truncate text-xs text-danger">
              {{ domain.lastError }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UiButton
              variant="secondary"
              :loading="domainBusy === `${domain.id}:apply`"
              @click="runDomainAction(domain, 'apply')"
            >
              Apply
            </UiButton>
            <UiButton
              v-if="domain.tls"
              variant="ghost"
              :loading="domainBusy === `${domain.id}:renew`"
              @click="runDomainAction(domain, 'renew')"
            >
              Renew
            </UiButton>
            <button
              type="button"
              title="Remove"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="domainToRemove = domain"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </UiCard>

    <!-- Network -->
    <UiCard v-if="canManage" title="Network">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Network</h2>
          <UiButton v-if="!editingPorts" variant="secondary" @click="startEditPorts">Edit</UiButton>
        </div>
      </template>

      <p class="mb-4 text-sm text-content-muted">
        Port exposed to the proxy:
        <span class="font-mono text-content">{{ application.port }}</span> — the proxy reaches the
        container by name; domains point to it (edit in Configuration).
      </p>

      <div class="border-t border-surface-border pt-4">
        <p class="mb-2 text-sm font-medium">Port mappings (host → container)</p>

        <template v-if="!editingPorts">
          <p v-if="!application.portMappings.length" class="text-sm text-content-muted">
            No mappings. Publish a host port to expose a service without going through the proxy.
          </p>
          <ul v-else class="flex flex-col divide-y divide-surface-border font-mono text-xs">
            <li
              v-for="(mapping, index) in application.portMappings"
              :key="index"
              class="flex gap-2 py-2"
            >
              <span>{{ mapping.hostPort }} → {{ mapping.containerPort }}</span>
              <span class="text-content-muted">/{{ mapping.protocol }}</span>
            </li>
          </ul>
        </template>

        <div v-else class="flex flex-col gap-3">
          <UiAlert v-if="portError" variant="error">{{ portError }}</UiAlert>

          <div v-for="(mapping, index) in portDraft" :key="index" class="flex items-center gap-2">
            <div class="flex-1">
              <UiInput v-model="mapping.hostPort" placeholder="Host (e.g. 8080)" />
            </div>
            <span class="text-content-muted">→</span>
            <div class="flex-1">
              <UiInput v-model="mapping.containerPort" placeholder="Container (e.g. 3000)" />
            </div>
            <div class="w-24">
              <UiSelect v-model="mapping.protocol" :options="protocolOptions" />
            </div>
            <button
              type="button"
              class="rounded-lg p-2 text-content-muted hover:text-danger"
              @click="removePort(index)"
            >
              <Icon name="lucide:x" class="size-4" />
            </button>
          </div>

          <div class="flex items-center justify-between">
            <UiButton variant="ghost" @click="addPort">
              <Icon name="lucide:plus" class="size-4" />
              Add
            </UiButton>
            <div class="flex gap-2">
              <UiButton variant="ghost" @click="editingPorts = false">Cancel</UiButton>
              <UiButton :loading="savingPorts" @click="savePorts">Save</UiButton>
            </div>
          </div>

          <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>
        </div>
      </div>
    </UiCard>

    <!-- Advanced -->
    <UiCard v-if="canManage" title="Advanced">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Advanced</h2>
          <UiButton v-if="!editingAdv" variant="secondary" @click="startEditAdv">Edit</UiButton>
        </div>
      </template>

      <!-- Read -->
      <dl v-if="!editingAdv" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="flex justify-between gap-2 sm:col-span-2">
          <dt class="text-content-muted">Volumes</dt>
          <dd class="text-right">
            <span v-if="!application.volumes.length" class="text-content-muted">None</span>
            <ul v-else class="font-mono text-xs">
              <li v-for="(volume, index) in application.volumes" :key="index">
                {{ volume.source }}:{{ volume.target }}{{ volume.readOnly ? ' (ro)' : '' }}
              </li>
            </ul>
          </dd>
        </div>
        <div class="flex justify-between gap-2 sm:col-span-2">
          <dt class="text-content-muted">Extra networks</dt>
          <dd class="font-mono text-xs">
            {{ application.networks.length ? application.networks.join(', ') : '—' }}
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Healthcheck</dt>
          <dd class="text-right">
            <span v-if="!application.healthcheck">Disabled</span>
            <span v-else class="font-mono text-xs">
              {{ application.healthcheck.path }} · {{ application.healthcheck.intervalSeconds }}s /
              {{ application.healthcheck.timeoutSeconds }}s ×{{ application.healthcheck.retries }}
            </span>
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Resources</dt>
          <dd>
            <span v-if="!application.resources?.cpus && !application.resources?.memoryMb">
              No limits
            </span>
            <span v-else class="font-mono text-xs">
              {{ application.resources?.cpus ? application.resources.cpus + ' CPU' : '' }}
              {{ application.resources?.memoryMb ? application.resources.memoryMb + ' MB' : '' }}
            </span>
          </dd>
        </div>
      </dl>

      <!-- Edit -->
      <div v-else class="flex flex-col gap-6">
        <UiAlert v-if="advError" variant="error">{{ advError }}</UiAlert>

        <div>
          <p class="mb-2 text-sm font-medium">Volumes</p>
          <div class="flex flex-col gap-2">
            <div
              v-for="(volume, index) in advDraft.volumes"
              :key="index"
              class="flex items-center gap-2"
            >
              <div class="flex-1">
                <UiInput v-model="volume.source" placeholder="source (volume or host path)" />
              </div>
              <span class="text-content-muted">:</span>
              <div class="flex-1">
                <UiInput v-model="volume.target" placeholder="/path/in/container" />
              </div>
              <UiCheckbox v-model="volume.readOnly" label="ro" />
              <button
                type="button"
                class="rounded-lg p-2 text-content-muted hover:text-danger"
                @click="removeVolume(index)"
              >
                <Icon name="lucide:x" class="size-4" />
              </button>
            </div>
            <UiButton variant="ghost" class="self-start" @click="addVolume">
              <Icon name="lucide:plus" class="size-4" />
              Add volume
            </UiButton>
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <p class="mb-2 text-sm font-medium">Extra networks</p>
          <div class="flex flex-col gap-2">
            <div
              v-for="(_, index) in advDraft.networks"
              :key="index"
              class="flex items-center gap-2"
            >
              <div class="flex-1">
                <UiInput v-model="advDraft.networks[index]" placeholder="docker-network-name" />
              </div>
              <button
                type="button"
                class="rounded-lg p-2 text-content-muted hover:text-danger"
                @click="removeNetwork(index)"
              >
                <Icon name="lucide:x" class="size-4" />
              </button>
            </div>
            <UiButton variant="ghost" class="self-start" @click="addNetwork">
              <Icon name="lucide:plus" class="size-4" />
              Add network
            </UiButton>
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <UiCheckbox v-model="advDraft.healthcheckEnabled" label="Enable healthcheck" />
          <div v-if="advDraft.healthcheckEnabled" class="mt-3 grid gap-4 sm:grid-cols-2">
            <UiInput v-model="advDraft.hcPath" label="Path" placeholder="/health" />
            <UiInput v-model="advDraft.hcInterval" label="Interval (s)" />
            <UiInput v-model="advDraft.hcTimeout" label="Timeout (s)" />
            <UiInput v-model="advDraft.hcRetries" label="Retries" />
            <UiInput v-model="advDraft.hcStartPeriod" label="Start period (s, optional)" />
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <p class="mb-2 text-sm font-medium">Resources (leave empty for no limit)</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput v-model="advDraft.cpus" label="CPUs" placeholder="e.g. 0.5" />
            <UiInput v-model="advDraft.memoryMb" label="Memory (MB)" placeholder="e.g. 512" />
          </div>
        </div>

        <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="editingAdv = false">Cancel</UiButton>
          <UiButton :loading="savingAdv" @click="saveAdv">Save</UiButton>
        </div>
      </div>
    </UiCard>

    <!-- Git webhook -->
    <UiCard v-if="canManage" title="Git webhook">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Git webhook</h2>
          <UiButton
            v-if="!application.git.hasWebhook"
            variant="secondary"
            :loading="webhookBusy"
            @click="onConfigureWebhook"
          >
            Configure webhook
          </UiButton>
        </div>
      </template>

      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 text-sm">
          <UiBadge :variant="application.git.hasWebhook ? 'success' : 'neutral'">
            {{ application.git.hasWebhook ? 'Configured' : 'Not configured' }}
          </UiBadge>
          <span class="text-content-muted">
            {{
              application.git.hasWebhook
                ? 'GitHub notifies this URL on every push, triggering auto-deploy.'
                : 'Without it, auto-deploy only runs if the webhook is set up manually on the repository.'
            }}
          </span>
        </div>

        <div
          v-if="application.git.hasWebhook && application.git.webhookUrl"
          class="flex items-center gap-2"
        >
          <code
            class="flex-1 truncate rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs"
          >
            {{ application.git.webhookUrl }}
          </code>
          <UiButton variant="ghost" type="button" @click="copyWebhookUrl">
            <Icon :name="webhookCopied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
            {{ webhookCopied ? 'Copied' : 'Copy' }}
          </UiButton>
        </div>

        <UiAlert v-if="!application.git.hasWebhook && application.git.autoDeploy" variant="info">
          Auto-deploy is enabled but no webhook is configured — configure it above so pushes deploy
          automatically.
        </UiAlert>

        <div v-if="application.git.hasWebhook" class="flex justify-end">
          <UiButton variant="ghost" :loading="webhookBusy" @click="onRemoveWebhook">
            Remove webhook
          </UiButton>
        </div>
      </div>
    </UiCard>

    <!-- Access token (private repository) -->
    <UiCard v-if="canManage" title="Access token">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Access token</h2>
          <UiButton v-if="!editingToken" variant="secondary" @click="startEditToken">
            {{ application.git.hasToken ? 'Replace' : 'Set' }}
          </UiButton>
        </div>
      </template>

      <template v-if="!editingToken">
        <div class="flex items-center gap-2 text-sm">
          <UiBadge :variant="application.git.hasToken ? 'success' : 'neutral'">
            {{ application.git.hasToken ? 'Configured' : 'Not configured' }}
          </UiBadge>
          <span class="text-content-muted">
            {{
              application.git.hasToken
                ? 'The platform clones the private repository with this token.'
                : 'Required only for private repositories (GitHub).'
            }}
          </span>
          <button
            v-if="application.git.hasToken"
            type="button"
            class="ml-auto rounded-lg px-2 py-1 text-xs text-content-muted transition-colors hover:text-danger"
            :disabled="savingToken"
            @click="saveToken(null)"
          >
            Remove
          </button>
        </div>
      </template>

      <div v-else class="flex flex-col gap-3">
        <UiInput
          v-model="tokenDraft"
          type="password"
          placeholder="GitHub Personal Access Token"
          hint="Repository read scope. Stored encrypted; never shown again."
        />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="editingToken = false">Cancel</UiButton>
          <UiButton :loading="savingToken" :disabled="!tokenDraft" @click="saveToken(tokenDraft)">
            Save
          </UiButton>
        </div>
      </div>
    </UiCard>

    <!-- Environment variables -->
    <UiCard v-if="canManage" title="Environment variables">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Environment variables</h2>
          <UiButton v-if="!editingVars" variant="secondary" @click="startEditVars">Edit</UiButton>
        </div>
      </template>

      <template v-if="!editingVars">
        <p v-if="!data?.variables.length" class="text-sm text-content-muted">
          No variables defined.
        </p>
        <ul v-else class="flex flex-col divide-y divide-surface-border font-mono text-xs">
          <li v-for="variable in data?.variables" :key="variable.key" class="flex gap-2 py-2">
            <span class="text-content-muted">{{ variable.key }}</span>
            <span class="truncate">{{ variable.secret ? '••••••••' : variable.value }}</span>
          </li>
        </ul>
      </template>

      <div v-else class="flex flex-col gap-3">
        <div v-for="(variable, index) in draft" :key="index" class="flex items-center gap-2">
          <div class="flex-1">
            <UiInput v-model="variable.key" placeholder="KEY" />
          </div>
          <div class="flex-1">
            <UiInput v-model="variable.value" placeholder="value" />
          </div>
          <UiCheckbox v-model="variable.secret" label="secret" />
          <button
            type="button"
            class="rounded-lg p-2 text-content-muted hover:text-danger"
            @click="removeVar(index)"
          >
            <Icon name="lucide:x" class="size-4" />
          </button>
        </div>

        <div class="flex items-center justify-between">
          <UiButton variant="ghost" @click="addVar">
            <Icon name="lucide:plus" class="size-4" />
            Add
          </UiButton>
          <div class="flex gap-2">
            <UiButton variant="ghost" @click="editingVars = false">Cancel</UiButton>
            <UiButton :loading="savingVars" @click="saveVars">Save</UiButton>
          </div>
        </div>
      </div>
    </UiCard>

    <!-- Deployment history -->
    <UiCard title="Deployments">
      <p v-if="!deploymentList.length" class="text-sm text-content-muted">No deployments yet.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="deployment in deploymentList" :key="deployment.id">
          <NuxtLink
            :to="`/applications/${application.id}/deployments/${deployment.id}`"
            class="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface"
          >
            <UiBadge :variant="DEPLOY_STATUS[deployment.status]">{{ deployment.status }}</UiBadge>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">
                {{ deployment.commit?.message || deployment.branch || 'deploy' }}
              </p>
              <p class="text-xs text-content-muted">
                {{ deployment.trigger }} ·
                {{ formatWhen(deployment.startedAt ?? deployment.createdAt) }}
                <span v-if="deployment.durationMs">
                  · {{ Math.round(deployment.durationMs / 1000) }}s</span
                >
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="step in deployment.steps"
                :key="step.step"
                :title="`${step.step}: ${step.status}`"
                class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                :class="{
                  'bg-success/15 text-success': step.status === 'ok',
                  'bg-danger/15 text-danger': step.status === 'failed',
                  'bg-surface text-content-muted': step.status === 'skipped',
                }"
              >
                {{ step.step }}
              </span>
            </div>
            <button
              v-if="canManage && deployment.status === 'succeeded'"
              type="button"
              title="Roll back to this deployment"
              class="rounded-lg border border-surface-border px-2 py-1 text-xs text-content-muted transition-colors hover:text-content"
              @click.stop.prevent="rollbackTarget = deployment"
            >
              <Icon name="lucide:rotate-ccw" class="size-3.5" />
              Rollback
            </button>
            <Icon name="lucide:chevron-right" class="size-4 text-content-muted" />
          </NuxtLink>
        </li>
      </ul>
    </UiCard>

    <!-- Danger zone -->
    <UiCard v-if="canManage" title="Danger zone">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-content-muted">
          Deletes this application, its deployment history and its domains. This cannot be undone.
        </p>
        <UiButton variant="danger" @click="confirmDeleteOpen = true">Delete application</UiButton>
      </div>
    </UiCard>

    <UiConfirm
      :open="Boolean(rollbackTarget)"
      title="Roll back deploy"
      :message="`Roll back to deployment ${rollbackTarget?.commit?.sha?.slice(0, 7) ?? ''} (${rollbackTarget?.commit?.message ?? 'no commit'})? Recreates the container with that deployment's image, without a rebuild.`"
      confirm-label="Roll back"
      :loading="rollingBack"
      @confirm="confirmRollback"
      @update:open="value => !value && (rollbackTarget = null)"
    />

    <UiConfirm
      :open="Boolean(domainToRemove)"
      title="Remove domain"
      :message="`Remove ${domainToRemove?.hostname}? The route stops responding.`"
      confirm-label="Remove"
      danger
      :loading="removingDomain"
      @confirm="confirmRemoveDomain"
      @update:open="value => !value && (domainToRemove = null)"
    />

    <UiConfirm
      :open="confirmDeleteOpen"
      title="Delete application"
      :message="`Delete “${application.name}”? Its deployments and domains are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingApp"
      @confirm="onDeleteApplication"
      @update:open="value => (confirmDeleteOpen = value)"
    />
  </section>

  <section v-else class="mx-auto max-w-4xl py-16 text-center text-sm text-content-muted">
    Loading…
  </section>
</template>
