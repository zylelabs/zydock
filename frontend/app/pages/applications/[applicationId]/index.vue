<script setup lang="ts">
  import { z } from 'zod';
  import {
    useApplications,
    type ApplicationStatus,
    type ApplicationVariable,
  } from '~/composables/services/useApplications';
  import {
    useDeployments,
    type Deployment,
    type DeploymentStatus,
  } from '~/composables/services/useDeployments';
  import {
    useDomains,
    type Domain,
    type DomainCertificate,
    type DomainStatus,
  } from '~/composables/services/useDomains';
  import { useMetrics } from '~/composables/services/useMetrics';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { formatDuration } from '~/utils';

  const route = useRoute();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const applications = useApplications();
  const deployments = useDeployments();
  const domains = useDomains();
  const metricsApi = useMetrics();

  const applicationId = computed(() => String(route.params.applicationId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const actionError = ref('');

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { data, refresh } = await useAsyncData(
    () => `application-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [app, deps, vars, doms] = await Promise.all([
        applications.get(applicationId.value),
        deployments.list({ applicationId: applicationId.value }),
        applications.listVariables(applicationId.value).catch(() => ({ variables: [] })),
        domains.list({ applicationId: applicationId.value }).catch(() => ({ items: [] })),
      ]);

      return {
        application: app.application,
        deployments: deps.items,
        variables: vars.variables,
        domains: doms.items,
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );

  const { data: metricsData, refresh: refreshMetrics } = await useAsyncData(
    () => `application-${applicationId.value}-metrics`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [metrics, deployMetrics] = await Promise.all([
        metricsApi.applicationMetrics(applicationId.value).catch(() => null),
        metricsApi.applicationDeploymentMetrics(applicationId.value).catch(() => null),
      ]);

      return { metrics, deployMetrics };
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

  const APP_STATUS: Record<ApplicationStatus, { label: string; color: string }> = {
    created: { label: 'Created', color: 'default' },
    deploying: { label: 'Deploying', color: 'blue' },
    running: { label: 'Running', color: 'green' },
    stopped: { label: 'Stopped', color: 'yellow' },
    failed: { label: 'Failed', color: 'red' },
  };

  const DEPLOY_STATUS: Record<DeploymentStatus, string> = {
    queued: 'default',
    running: 'blue',
    succeeded: 'green',
    failed: 'red',
  };

  const DOMAIN_STATUS: Record<DomainStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'yellow' },
    active: { label: 'Active', color: 'green' },
    error: { label: 'Error', color: 'red' },
  };

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('en-US') : '—');

  const metrics = computed(() => metricsData.value?.metrics ?? null);
  const deployMetrics = computed(() => metricsData.value?.deployMetrics ?? null);
  const memoryPercent = computed(() => {
    const value = metrics.value;

    return value?.memoryLimitMb ? Math.round((value.memoryUsedMb / value.memoryLimitMb) * 100) : 0;
  });

  const METRICS_INTERVAL_MS = 30000;

  let metricsTimer: ReturnType<typeof setInterval> | undefined;

  const stopMetricsPolling = () => {
    if (!metricsTimer) {
      return;
    }

    clearInterval(metricsTimer);
    metricsTimer = undefined;
  };

  const startMetricsPolling = () => {
    if (metricsTimer) {
      return;
    }

    metricsTimer = setInterval(() => refreshMetrics(), METRICS_INTERVAL_MS);
  };

  const handleMetricsVisibility = () => {
    if (document.visibilityState !== 'visible') {
      stopMetricsPolling();
      return;
    }

    refreshMetrics();
    startMetricsPolling();
  };

  onMounted(() => {
    document.addEventListener('visibilitychange', handleMetricsVisibility);
    startMetricsPolling();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleMetricsVisibility);
    stopMetricsPolling();
  });

  const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'] as const;
  const restartOptions = RESTART_POLICIES.map(value => ({ value, label: value }));

  const editingConfig = ref(false);

  const configForm = useSchemaForm(
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
      restartPolicy: z.string().trim().min(1, 'Choose a restart policy'),
    }),
    {
      name: '',
      repository: '',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
      port: '3000',
      autoDeploy: true,
      restartPolicy: 'unless-stopped',
    },
  );

  const startEditConfig = () => {
    const app = application.value;

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
    configForm.values.restartPolicy = app.restartPolicy;
    editingConfig.value = true;
  };

  const handleSaveConfig = configForm.submit(async values => {
    await applications.update(applicationId.value, {
      name: values.name,
      port: Number(values.port),
      restartPolicy: values.restartPolicy,
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

  const deploying = ref(false);

  const triggerDeploy = async () => {
    actionError.value = '';
    deploying.value = true;

    try {
      const { deployment } = await applications.deploy(applicationId.value);

      await navigateTo(`/applications/${applicationId.value}/deployments/${deployment.id}`);
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to start the deployment.');
    } finally {
      deploying.value = false;
    }
  };

  const rollbackTarget = ref<Deployment | null>(null);
  const rollingBack = ref(false);

  const rollbackOpen = computed({
    get: () => Boolean(rollbackTarget.value),
    set: value => {
      if (!value) {
        rollbackTarget.value = null;
      }
    },
  });

  const rollbackMessage = computed(
    () =>
      `Roll back to deployment ${rollbackTarget.value?.commit?.sha?.slice(0, 7) ?? ''} (${rollbackTarget.value?.commit?.message ?? 'no commit'})? Recreates the container with that deployment's image, without a rebuild.`,
  );

  const confirmRollback = async () => {
    if (!rollbackTarget.value) {
      return;
    }

    actionError.value = '';
    rollingBack.value = true;

    try {
      const { deployment } = await applications.rollback(
        applicationId.value,
        rollbackTarget.value.id,
      );

      rollbackTarget.value = null;
      await navigateTo(`/applications/${applicationId.value}/deployments/${deployment.id}`);
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to roll back.');
    } finally {
      rollingBack.value = false;
    }
  };

  const lifecycleBusy = ref('');

  const runLifecycle = async (action: 'restart' | 'stop' | 'start') => {
    actionError.value = '';
    lifecycleBusy.value = action;

    try {
      await applications[action](applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'The operation failed.');
    } finally {
      lifecycleBusy.value = '';
    }
  };

  type PortDraft = { hostPort: string; containerPort: string; protocol: string };

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
          protocol: row.protocol === 'udp' ? 'udp' : 'tcp',
        })),
      });

      editingPorts.value = false;
      await refresh();
    } catch (error) {
      portError.value = messageOf(error, 'Failed to save the ports.');
    } finally {
      savingPorts.value = false;
    }
  };

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
      body.healthcheck = null;
    }

    advError.value = '';
    savingAdv.value = true;

    try {
      await applications.update(applicationId.value, body);

      editingAdv.value = false;
      await refresh();
    } catch (error) {
      advError.value = messageOf(error, 'Failed to save.');
    } finally {
      savingAdv.value = false;
    }
  };

  const domainList = computed(() => data.value?.domains ?? []);

  const addingDomain = ref(false);
  const domainBusy = ref('');

  const domainForm = useSchemaForm(
    z.object({
      hostname: z.string().trim().min(1, 'Enter the domain'),
      pathPrefix: z.string().trim(),
      tls: z.boolean(),
    }),
    { hostname: '', pathPrefix: '', tls: true },
  );

  const openAddDomain = () => {
    domainForm.reset();
    addingDomain.value = true;
  };

  const handleCreateDomain = domainForm.submit(async values => {
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
      actionError.value = messageOf(error, 'The operation failed.');
    } finally {
      domainBusy.value = '';
    }
  };

  const domainToRemove = ref<Domain | null>(null);
  const removingDomain = ref(false);

  const removeDomainOpen = computed({
    get: () => Boolean(domainToRemove.value),
    set: value => {
      if (!value) {
        domainToRemove.value = null;
      }
    },
  });

  const confirmRemoveDomain = async () => {
    if (!domainToRemove.value) {
      return;
    }

    actionError.value = '';
    removingDomain.value = true;

    try {
      await domains.remove(domainToRemove.value.id);
      await refresh();
      domainToRemove.value = null;
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to remove.');
    } finally {
      removingDomain.value = false;
    }
  };

  const editingDomain = ref('');
  const editDomainPathPrefix = ref('');
  const editDomainTls = ref(true);
  const editDomainError = ref('');
  const editDomainBusy = ref(false);

  const startEditDomain = (domain: Domain) => {
    actionError.value = '';
    editDomainError.value = '';
    editingDomain.value = domain.id;
    editDomainPathPrefix.value = domain.pathPrefix ?? '';
    editDomainTls.value = domain.tls;
  };

  const saveEditDomain = async () => {
    editDomainError.value = '';
    editDomainBusy.value = true;

    try {
      await domains.update(editingDomain.value, {
        pathPrefix: editDomainPathPrefix.value.trim() || null,
        tls: editDomainTls.value,
      });

      editingDomain.value = '';
      await refresh();
    } catch (error) {
      editDomainError.value = messageOf(error, 'Failed to save the domain.');
    } finally {
      editDomainBusy.value = false;
    }
  };

  const domainCertificates = ref<Record<string, DomainCertificate>>({});
  const domainCertificateFailed = ref<Record<string, boolean>>({});
  const domainCertificateOpen = ref('');
  const domainCertificateLoading = ref(false);

  const toggleDomainCertificate = async (domain: Domain) => {
    if (domainCertificateOpen.value === domain.id) {
      domainCertificateOpen.value = '';
      return;
    }

    domainCertificateOpen.value = domain.id;

    if (domainCertificates.value[domain.id] || domainCertificateFailed.value[domain.id]) {
      return;
    }

    domainCertificateLoading.value = true;

    try {
      domainCertificates.value[domain.id] = await domains.certificate(domain.id);
    } catch {
      domainCertificateFailed.value[domain.id] = true;
    } finally {
      domainCertificateLoading.value = false;
    }
  };

  const domainDaysRemaining = (expiresAt?: string) =>
    expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : undefined;

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
      actionError.value = messageOf(error, 'Failed to save the variables.');
    } finally {
      savingVars.value = false;
    }
  };

  const editingToken = ref(false);
  const tokenDraft = ref('');
  const savingToken = ref(false);

  const startEditToken = () => {
    tokenDraft.value = '';
    editingToken.value = true;
  };

  const saveToken = async (token: string | null) => {
    actionError.value = '';
    savingToken.value = true;

    try {
      await applications.update(applicationId.value, { git: { token } });

      editingToken.value = false;
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to save the token.');
    } finally {
      savingToken.value = false;
    }
  };

  const webhookBusy = ref(false);
  const webhookCopied = ref(false);

  const handleConfigureWebhook = async () => {
    actionError.value = '';
    webhookBusy.value = true;

    try {
      await applications.configureWebhook(applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to configure the webhook.');
    } finally {
      webhookBusy.value = false;
    }
  };

  const handleRemoveWebhook = async () => {
    actionError.value = '';
    webhookBusy.value = true;

    try {
      await applications.removeWebhook(applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to remove the webhook.');
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

  const confirmDeleteOpen = ref(false);
  const deletingApp = ref(false);

  const handleDeleteApplication = async () => {
    actionError.value = '';
    deletingApp.value = true;

    try {
      const projectId = application.value?.projectId;

      await applications.remove(applicationId.value);
      await navigateTo(projectId ? `/projects/${projectId}` : '/projects');
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to delete the application.');
      deletingApp.value = false;
    }
  };
</script>

<template>
  <Content v-if="application">
    <NuxtLink
      :to="`/projects/${application.projectId}`"
      class="mb-4 inline-flex items-center gap-1 text-sm text-content-muted transition-colors hover:text-content-strong"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Project
    </NuxtLink>

    <Header :title="application.name">
      <template #right>
        <div class="flex flex-wrap items-center gap-2">
          <Tag :color="APP_STATUS[application.status].color">
            {{ APP_STATUS[application.status].label }}
          </Tag>
          <Button theme="secondary" :to="`/applications/${application.id}/logs`">
            <Icon name="lucide:scroll-text" class="size-4" />
            Logs
          </Button>
          <Button theme="secondary" :to="`/applications/${application.id}/console`">
            <Icon name="lucide:square-terminal" class="size-4" />
            Console
          </Button>
          <template v-if="canManage">
            <Button
              v-if="application.status === 'running'"
              theme="secondary"
              :disabled="lifecycleBusy === 'stop'"
              @click="runLifecycle('stop')"
            >
              <Icon
                :name="lifecycleBusy === 'stop' ? 'svg-spinners:tadpole' : 'lucide:square'"
                class="size-4"
              />
              Stop
            </Button>
            <Button
              v-else-if="application.status === 'stopped'"
              theme="secondary"
              :disabled="lifecycleBusy === 'start'"
              @click="runLifecycle('start')"
            >
              <Icon
                :name="lifecycleBusy === 'start' ? 'svg-spinners:tadpole' : 'lucide:play'"
                class="size-4"
              />
              Start
            </Button>
            <Button
              v-if="application.status === 'running'"
              theme="secondary"
              :disabled="lifecycleBusy === 'restart'"
              @click="runLifecycle('restart')"
            >
              <Icon
                :name="lifecycleBusy === 'restart' ? 'svg-spinners:tadpole' : 'lucide:rotate-cw'"
                class="size-4"
              />
              Restart
            </Button>
            <Button theme="primary" :disabled="deploying" @click="triggerDeploy">
              <Icon :name="deploying ? 'svg-spinners:tadpole' : 'lucide:rocket'" class="size-4" />
              {{ deploymentList.length ? 'Redeploy' : 'Deploy' }}
            </Button>
          </template>
        </div>
      </template>
    </Header>

    <div class="flex flex-col gap-6">
      <Alert v-if="actionError" theme="error">{{ actionError }}</Alert>
      <Alert v-if="application.lastError" theme="error">{{ application.lastError }}</Alert>

      <NuxtLink
        v-if="runningDeployment"
        :to="`/applications/${application.id}/deployments/${runningDeployment.id}`"
        class="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary transition-colors hover:bg-primary/15"
      >
        <Icon name="lucide:loader" class="size-4 animate-spin" />
        Deployment in progress — view live logs
      </NuxtLink>

      <Card v-if="metrics || (deployMetrics && deployMetrics.window)" title="Resources">
        <div v-if="metrics" class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <Tag color="blue">{{ metrics.state }}</Tag>
            <Tag
              v-if="metrics.health !== 'none'"
              :color="metrics.health === 'healthy' ? 'green' : 'yellow'"
            >
              {{ metrics.health }}
            </Tag>
            <span class="text-xs text-content-muted">restarts: {{ metrics.restartCount }}</span>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <div class="mb-1 flex justify-between text-xs text-content-muted">
                <span>CPU</span><span>{{ Math.round(metrics.cpuPercent) }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
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
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div class="h-full bg-primary" :style="{ width: `${memoryPercent}%` }" />
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="deployMetrics && deployMetrics.window"
          class="grid gap-3 pt-4 text-sm sm:grid-cols-3"
          :class="metrics && 'mt-4 border-t border-surface-line'"
        >
          <div>
            <p class="text-xs text-content-muted">Success rate</p>
            <p class="font-medium text-content-strong">{{ deployMetrics.successRate }}%</p>
          </div>
          <div>
            <p class="text-xs text-content-muted">Avg. duration</p>
            <p class="font-medium text-content-strong">
              {{ formatDuration(deployMetrics.averageDurationMs ?? undefined) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-content-muted">Avg. build time</p>
            <p class="font-medium text-content-strong">
              {{ formatDuration(deployMetrics.averageBuildMs ?? undefined) }}
            </p>
          </div>
        </div>
      </Card>

      <Card title="Configuration">
        <template #right>
          <Button v-if="canManage && !editingConfig" theme="secondary" @click="startEditConfig">
            Edit
          </Button>
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

        <form v-else class="flex flex-col gap-4" @submit.prevent="handleSaveConfig">
          <Alert v-if="configForm.formError.value" theme="error">
            {{ configForm.formError.value }}
          </Alert>

          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="configForm.values.name"
              label="Name"
              :call-error="configForm.errors.value.name"
            />
            <Input
              v-model="configForm.values.repository"
              label="Repository (GitHub)"
              placeholder="owner/repository"
              :call-error="configForm.errors.value.repository"
            />
            <Input
              v-model="configForm.values.branch"
              label="Branch"
              :call-error="configForm.errors.value.branch"
            />
            <Input
              v-model="configForm.values.dockerfilePath"
              label="Dockerfile"
              :call-error="configForm.errors.value.dockerfilePath"
            />
            <Input
              v-model="configForm.values.buildContext"
              label="Build context"
              :call-error="configForm.errors.value.buildContext"
            />
            <Input
              v-model="configForm.values.port"
              label="Port"
              :call-error="configForm.errors.value.port"
            />
            <Select
              v-model="configForm.values.restartPolicy"
              label="Restart policy"
              :options="restartOptions"
            />
          </div>

          <Switch v-model="configForm.values.autoDeploy" label="Auto-deploy on every push" />

          <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="editingConfig = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="configForm.loading.value">
              <Icon v-if="configForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card v-if="canManage" title="Domains">
        <template #right>
          <Button v-if="!addingDomain" theme="secondary" @click="openAddDomain">
            <Icon name="proicons:add" size="18" />
            Add
          </Button>
        </template>

        <form
          v-if="addingDomain"
          class="mb-4 flex flex-col gap-4 rounded-lg border border-surface-border p-4"
          @submit.prevent="handleCreateDomain"
        >
          <Alert v-if="domainForm.formError.value" theme="error">
            {{ domainForm.formError.value }}
          </Alert>

          <div class="grid gap-4 sm:grid-cols-2">
            <Input
              v-model="domainForm.values.hostname"
              label="Domain"
              placeholder="app.example.com"
              :call-error="domainForm.errors.value.hostname"
            />
            <Input
              v-model="domainForm.values.pathPrefix"
              label="Path prefix (optional)"
              placeholder="/api"
            />
          </div>

          <Switch v-model="domainForm.values.tls" label="Automatic HTTPS (Let's Encrypt)" />

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="addingDomain = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="domainForm.loading.value">
              <Icon v-if="domainForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Add
            </Button>
          </div>
        </form>

        <p v-if="!domainList.length" class="text-sm text-content-muted">
          No domains yet. Add one to publish this application on its own address.
        </p>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="domain in domainList"
            :key="domain.id"
            class="flex flex-col gap-3 rounded-lg border border-surface-border p-3"
          >
            <div class="flex flex-wrap items-center gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <Icon v-if="domain.tls" name="lucide:lock" class="size-4 text-success" />
                  <span class="truncate font-medium text-content-strong">
                    {{ domain.hostname }}{{ domain.pathPrefix }}
                  </span>
                  <Tag :color="DOMAIN_STATUS[domain.status].color">
                    {{ DOMAIN_STATUS[domain.status].label }}
                  </Tag>
                </div>
                <p v-if="domain.lastError" class="mt-1 truncate text-xs text-danger">
                  {{ domain.lastError }}
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  theme="secondary"
                  :disabled="domainBusy === `${domain.id}:apply`"
                  @click="runDomainAction(domain, 'apply')"
                >
                  <Icon
                    v-if="domainBusy === `${domain.id}:apply`"
                    name="svg-spinners:tadpole"
                    size="16"
                  />
                  Apply
                </Button>
                <Button
                  v-if="domain.tls"
                  theme="ghost"
                  :disabled="domainBusy === `${domain.id}:renew`"
                  @click="runDomainAction(domain, 'renew')"
                >
                  <Icon
                    v-if="domainBusy === `${domain.id}:renew`"
                    name="svg-spinners:tadpole"
                    size="16"
                  />
                  Renew
                </Button>
                <Button theme="ghost" @click="toggleDomainCertificate(domain)">Certificate</Button>
                <Button theme="ghost" @click="startEditDomain(domain)">Edit</Button>
                <button
                  type="button"
                  title="Remove"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
                  @click="domainToRemove = domain"
                >
                  <Icon name="lucide:trash-2" class="size-4" />
                </button>
              </div>
            </div>

            <form
              v-if="editingDomain === domain.id"
              class="flex flex-col gap-3 border-t border-surface-line pt-3"
              @submit.prevent="saveEditDomain"
            >
              <Alert v-if="editDomainError" theme="error">{{ editDomainError }}</Alert>

              <div class="grid gap-4 sm:grid-cols-2">
                <Input v-model="editDomainPathPrefix" label="Path prefix" placeholder="/api" />
                <div class="flex items-end pb-2">
                  <Switch v-model="editDomainTls" label="Automatic HTTPS (Let's Encrypt)" />
                </div>
              </div>

              <p class="text-xs text-content-muted">
                To change the hostname or the linked application, remove this domain and add it
                again.
              </p>

              <div class="flex justify-end gap-2">
                <Button theme="ghost" type="button" @click="editingDomain = ''">Cancel</Button>
                <Button theme="primary" type="submit" :disabled="editDomainBusy">
                  <Icon v-if="editDomainBusy" name="svg-spinners:tadpole" size="16" />
                  Save
                </Button>
              </div>
            </form>

            <div
              v-if="domainCertificateOpen === domain.id"
              class="border-t border-surface-line pt-3 text-sm"
            >
              <p v-if="domainCertificateLoading" class="text-content-muted">Loading…</p>
              <p v-else-if="domainCertificateFailed[domain.id]" class="text-danger">
                Failed to load the certificate.
              </p>
              <template v-else-if="domainCertificates[domain.id]">
                <div class="flex flex-wrap items-center gap-3">
                  <Tag :color="domainCertificates[domain.id]!.valid ? 'green' : 'red'">
                    {{ domainCertificates[domain.id]!.valid ? 'Valid' : 'Invalid' }}
                  </Tag>
                  <span v-if="domainCertificates[domain.id]!.issuer" class="text-content-muted">
                    Issued by {{ domainCertificates[domain.id]!.issuer }}
                  </span>
                </div>
                <p v-if="domainCertificates[domain.id]!.expiresAt" class="mt-1 text-content-muted">
                  Expires
                  {{
                    new Date(domainCertificates[domain.id]!.expiresAt!).toLocaleDateString('en-US')
                  }}
                  <span
                    v-if="
                      domainDaysRemaining(domainCertificates[domain.id]!.expiresAt) !== undefined
                    "
                  >
                    ({{ domainDaysRemaining(domainCertificates[domain.id]!.expiresAt) }} days
                    remaining)
                  </span>
                </p>
              </template>
            </div>
          </div>
        </div>
      </Card>

      <Card v-if="canManage" title="Network">
        <template #right>
          <Button v-if="!editingPorts" theme="secondary" @click="startEditPorts">Edit</Button>
        </template>

        <p class="mb-4 text-sm text-content-muted">
          Port exposed to the proxy:
          <span class="font-mono text-content">{{ application.port }}</span> — the proxy reaches the
          container by name; domains point to it (edit in Configuration).
        </p>

        <div class="border-t border-surface-line pt-4">
          <p class="mb-2 text-sm font-medium text-content-strong">
            Port mappings (host → container)
          </p>

          <template v-if="!editingPorts">
            <p v-if="!application.portMappings.length" class="text-sm text-content-muted">
              No mappings. Publish a host port to expose a service without going through the proxy.
            </p>
            <ul v-else class="flex flex-col divide-y divide-surface-line font-mono text-xs">
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
            <Alert v-if="portError" theme="error">{{ portError }}</Alert>

            <div v-for="(mapping, index) in portDraft" :key="index" class="flex items-center gap-2">
              <Input v-model="mapping.hostPort" class="flex-1" placeholder="Host (e.g. 8080)" />
              <span class="text-content-muted">→</span>
              <Input
                v-model="mapping.containerPort"
                class="flex-1"
                placeholder="Container (e.g. 3000)"
              />
              <div class="w-24">
                <Select v-model="mapping.protocol" :options="protocolOptions" />
              </div>
              <button
                type="button"
                class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                @click="removePort(index)"
              >
                <Icon name="lucide:x" class="size-4" />
              </button>
            </div>

            <div class="flex items-center justify-between">
              <Button theme="ghost" @click="addPort">
                <Icon name="proicons:add" size="18" />
                Add
              </Button>
              <div class="flex gap-2">
                <Button theme="ghost" @click="editingPorts = false">Cancel</Button>
                <Button theme="primary" :disabled="savingPorts" @click="savePorts">
                  <Icon v-if="savingPorts" name="svg-spinners:tadpole" size="16" />
                  Save
                </Button>
              </div>
            </div>

            <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>
          </div>
        </div>
      </Card>

      <Card v-if="canManage" title="Advanced">
        <template #right>
          <Button v-if="!editingAdv" theme="secondary" @click="startEditAdv">Edit</Button>
        </template>

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
                {{ application.healthcheck.path }} · {{ application.healthcheck.intervalSeconds }}s
                / {{ application.healthcheck.timeoutSeconds }}s ×{{
                  application.healthcheck.retries
                }}
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

        <div v-else class="flex flex-col gap-6">
          <Alert v-if="advError" theme="error">{{ advError }}</Alert>

          <div>
            <p class="mb-2 text-sm font-medium text-content-strong">Volumes</p>
            <div class="flex flex-col gap-2">
              <div
                v-for="(volume, index) in advDraft.volumes"
                :key="index"
                class="flex items-center gap-2"
              >
                <Input
                  v-model="volume.source"
                  class="flex-1"
                  placeholder="source (volume or host path)"
                />
                <span class="text-content-muted">:</span>
                <Input v-model="volume.target" class="flex-1" placeholder="/path/in/container" />
                <label class="flex cursor-pointer items-center gap-1 text-xs text-content-muted">
                  <Checkbox v-model="volume.readOnly" />
                  ro
                </label>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                  @click="removeVolume(index)"
                >
                  <Icon name="lucide:x" class="size-4" />
                </button>
              </div>
              <Button theme="ghost" class="self-start" @click="addVolume">
                <Icon name="proicons:add" size="18" />
                Add volume
              </Button>
            </div>
          </div>

          <div class="border-t border-surface-line pt-4">
            <p class="mb-2 text-sm font-medium text-content-strong">Extra networks</p>
            <div class="flex flex-col gap-2">
              <div
                v-for="(_, index) in advDraft.networks"
                :key="index"
                class="flex items-center gap-2"
              >
                <Input
                  v-model="advDraft.networks[index]"
                  class="flex-1"
                  placeholder="docker-network-name"
                />
                <button
                  type="button"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                  @click="removeNetwork(index)"
                >
                  <Icon name="lucide:x" class="size-4" />
                </button>
              </div>
              <Button theme="ghost" class="self-start" @click="addNetwork">
                <Icon name="proicons:add" size="18" />
                Add network
              </Button>
            </div>
          </div>

          <div class="border-t border-surface-line pt-4">
            <Switch v-model="advDraft.healthcheckEnabled" label="Enable healthcheck" />
            <div v-if="advDraft.healthcheckEnabled" class="mt-3 grid gap-4 sm:grid-cols-2">
              <Input v-model="advDraft.hcPath" label="Path" placeholder="/health" />
              <Input v-model="advDraft.hcInterval" label="Interval (s)" />
              <Input v-model="advDraft.hcTimeout" label="Timeout (s)" />
              <Input v-model="advDraft.hcRetries" label="Retries" />
              <Input v-model="advDraft.hcStartPeriod" label="Start period (s, optional)" />
            </div>
          </div>

          <div class="border-t border-surface-line pt-4">
            <p class="mb-2 text-sm font-medium text-content-strong">
              Resources (leave empty for no limit)
            </p>
            <div class="grid gap-4 sm:grid-cols-2">
              <Input v-model="advDraft.cpus" label="CPUs" placeholder="e.g. 0.5" />
              <Input v-model="advDraft.memoryMb" label="Memory (MB)" placeholder="e.g. 512" />
            </div>
          </div>

          <p class="text-xs text-content-muted">Changes take effect on the next deploy.</p>

          <div class="flex justify-end gap-2">
            <Button theme="ghost" @click="editingAdv = false">Cancel</Button>
            <Button theme="primary" :disabled="savingAdv" @click="saveAdv">
              <Icon v-if="savingAdv" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </div>
      </Card>

      <Card v-if="canManage" title="Git webhook">
        <template #right>
          <Button
            v-if="!application.git.hasWebhook"
            theme="secondary"
            :disabled="webhookBusy"
            @click="handleConfigureWebhook"
          >
            <Icon v-if="webhookBusy" name="svg-spinners:tadpole" size="16" />
            Configure webhook
          </Button>
        </template>

        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2 text-sm">
            <Tag :color="application.git.hasWebhook ? 'green' : 'default'">
              {{ application.git.hasWebhook ? 'Configured' : 'Not configured' }}
            </Tag>
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
              class="flex-1 truncate rounded-lg border border-surface-border bg-surface-sunken px-3 py-2 text-xs"
            >
              {{ application.git.webhookUrl }}
            </code>
            <Button theme="ghost" type="button" @click="copyWebhookUrl">
              <Icon :name="webhookCopied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
              {{ webhookCopied ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <Alert v-if="!application.git.hasWebhook && application.git.autoDeploy" theme="info">
            Auto-deploy is enabled but no webhook is configured — configure it above so pushes
            deploy automatically.
          </Alert>

          <div v-if="application.git.hasWebhook" class="flex justify-end">
            <Button theme="ghost" :disabled="webhookBusy" @click="handleRemoveWebhook">
              <Icon v-if="webhookBusy" name="svg-spinners:tadpole" size="16" />
              Remove webhook
            </Button>
          </div>
        </div>
      </Card>

      <Card v-if="canManage" title="Access token">
        <template #right>
          <Button v-if="!editingToken" theme="secondary" @click="startEditToken">
            {{ application.git.hasToken ? 'Replace' : 'Set' }}
          </Button>
        </template>

        <div v-if="!editingToken" class="flex items-center gap-2 text-sm">
          <Tag :color="application.git.hasToken ? 'green' : 'default'">
            {{ application.git.hasToken ? 'Configured' : 'Not configured' }}
          </Tag>
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
            class="ml-auto cursor-pointer rounded-lg px-2 py-1 text-xs text-content-muted transition-colors hover:text-danger"
            :disabled="savingToken"
            @click="saveToken(null)"
          >
            Remove
          </button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <Input v-model="tokenDraft" password placeholder="GitHub Personal Access Token" />
          <p class="text-xs text-content-muted">
            Repository read scope. Stored encrypted; never shown again.
          </p>
          <div class="flex justify-end gap-2">
            <Button theme="ghost" @click="editingToken = false">Cancel</Button>
            <Button
              theme="primary"
              :disabled="savingToken || !tokenDraft"
              @click="saveToken(tokenDraft)"
            >
              <Icon v-if="savingToken" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </div>
      </Card>

      <Card v-if="canManage" title="Environment variables">
        <template #right>
          <Button v-if="!editingVars" theme="secondary" @click="startEditVars">Edit</Button>
        </template>

        <template v-if="!editingVars">
          <p v-if="!data?.variables.length" class="text-sm text-content-muted">
            No variables defined.
          </p>
          <ul v-else class="flex flex-col divide-y divide-surface-line font-mono text-xs">
            <li v-for="variable in data?.variables" :key="variable.key" class="flex gap-2 py-2">
              <span class="text-content-muted">{{ variable.key }}</span>
              <span class="truncate">{{ variable.secret ? '••••••••' : variable.value }}</span>
            </li>
          </ul>
        </template>

        <div v-else class="flex flex-col gap-3">
          <div v-for="(variable, index) in draft" :key="index" class="flex items-center gap-2">
            <Input v-model="variable.key" class="flex-1" placeholder="KEY" />
            <Input v-model="variable.value" class="flex-1" placeholder="value" />
            <label class="flex cursor-pointer items-center gap-1 text-xs text-content-muted">
              <Checkbox v-model="variable.secret" />
              secret
            </label>
            <button
              type="button"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="removeVar(index)"
            >
              <Icon name="lucide:x" class="size-4" />
            </button>
          </div>

          <div class="flex items-center justify-between">
            <Button theme="ghost" @click="addVar">
              <Icon name="proicons:add" size="18" />
              Add
            </Button>
            <div class="flex gap-2">
              <Button theme="ghost" @click="editingVars = false">Cancel</Button>
              <Button theme="primary" :disabled="savingVars" @click="saveVars">
                <Icon v-if="savingVars" name="svg-spinners:tadpole" size="16" />
                Save
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Deployments">
        <p v-if="!deploymentList.length" class="text-sm text-content-muted">No deployments yet.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-line">
          <li v-for="deployment in deploymentList" :key="deployment.id">
            <NuxtLink
              :to="`/applications/${application.id}/deployments/${deployment.id}`"
              class="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-hover"
            >
              <Tag :color="DEPLOY_STATUS[deployment.status]">{{ deployment.status }}</Tag>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-content-strong">
                  {{ deployment.commit?.message || deployment.branch || 'deploy' }}
                </p>
                <p class="text-xs text-content-muted">
                  {{ deployment.trigger }} ·
                  {{ formatWhen(deployment.startedAt ?? deployment.createdAt) }}
                  <span v-if="deployment.durationMs">
                    · {{ Math.round(deployment.durationMs / 1000) }}s
                  </span>
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
                    'bg-surface-sunken text-content-muted': step.status === 'skipped',
                  }"
                >
                  {{ step.step }}
                </span>
              </div>
              <button
                v-if="canManage && deployment.status === 'succeeded'"
                type="button"
                title="Roll back to this deployment"
                class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-content-muted transition-colors hover:text-content-strong"
                @click.stop.prevent="rollbackTarget = deployment"
              >
                <Icon name="lucide:rotate-ccw" class="size-3.5" />
                Rollback
              </button>
              <Icon name="lucide:chevron-right" class="size-4 text-content-muted" />
            </NuxtLink>
          </li>
        </ul>
      </Card>

      <Card v-if="canManage" title="Danger zone">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-content-muted">
            Deletes this application, its deployment history and its domains. This cannot be undone.
          </p>
          <Button theme="danger" class="shrink-0" @click="confirmDeleteOpen = true">
            Delete application
          </Button>
        </div>
      </Card>
    </div>

    <Confirm
      v-model:open="rollbackOpen"
      title="Roll back deploy"
      :message="rollbackMessage"
      confirm-label="Roll back"
      :loading="rollingBack"
      @confirm="confirmRollback"
    />

    <Confirm
      v-model:open="removeDomainOpen"
      title="Remove domain"
      :message="`Remove ${domainToRemove?.hostname}? The route stops responding.`"
      confirm-label="Remove"
      danger
      :loading="removingDomain"
      @confirm="confirmRemoveDomain"
    />

    <Confirm
      v-model:open="confirmDeleteOpen"
      title="Delete application"
      :message="`Delete “${application.name}”? Its deployments and domains are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingApp"
      @confirm="handleDeleteApplication"
    />
  </Content>

  <Content v-else>
    <p class="py-16 text-center text-sm text-content-muted">Loading…</p>
  </Content>
</template>
