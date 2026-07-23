<script setup lang="ts">
  import { z } from 'zod';
  import type { ApplicationStatus, ApplicationVariable } from '~/composables/use-applications';
  import type { DeploymentStatus } from '~/composables/use-deployments';

  const route = useRoute();
  const session = useSessionStore();
  const applicationId = computed(() => String(route.params.applicationId));

  const { current } = useOrganizations();
  const applications = useApplications();
  const deployments = useDeployments();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');

  const { data, refresh } = await useAsyncData(
    () => `application-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [app, deps, vars] = await Promise.all([
        applications.get(applicationId.value),
        deployments.list({ applicationId: applicationId.value }),
        applications.listVariables(applicationId.value).catch(() => ({ variables: [] })),
      ]);

      return { application: app.application, deployments: deps.items, variables: vars.variables };
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );

  useHead(() => ({ title: data.value?.application.name ?? 'Aplicação' }));

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
    created: { label: 'Criada', variant: 'neutral' },
    deploying: { label: 'Implantando', variant: 'info' },
    running: { label: 'Rodando', variant: 'success' },
    stopped: { label: 'Parada', variant: 'warning' },
    failed: { label: 'Falhou', variant: 'danger' },
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

  const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString('pt-BR') : '—');

  const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'] as const;
  const restartOptions = RESTART_POLICIES.map(value => ({ value, label: value }));

  const editingConfig = ref(false);

  const configForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Informe um nome'),
      repository: z
        .string()
        .trim()
        .regex(/^[^/\s]+\/[^/\s]+$/, 'Use o formato dono/repositório'),
      branch: z.string().trim().min(1, 'Informe a branch'),
      dockerfilePath: z.string().trim().min(1, 'Informe o Dockerfile'),
      buildContext: z.string().trim().min(1, 'Informe o contexto de build'),
      port: z.string().regex(/^\d+$/, 'Porta inválida'),
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
      actionError.value = (error as { message?: string }).message || 'Falha ao disparar o deploy.';
    } finally {
      deploying.value = false;
    }
  };

  // --- Ciclo de vida (reiniciar / parar / iniciar) -----------------------------------------------

  const lifecycleBusy = ref('');

  const runLifecycle = async (action: 'restart' | 'stop' | 'start') => {
    actionError.value = '';
    lifecycleBusy.value = action;

    try {
      await applications[action](applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Falha na operação.';
    } finally {
      lifecycleBusy.value = '';
    }
  };

  // --- Network (mapeamento de portas) ------------------------------------------------------------

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
      portError.value = 'Informe portas válidas (1–65535) em host e container.';
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
      portError.value = (error as { message?: string }).message || 'Falha ao salvar as portas.';
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
      advError.value = 'Cada volume precisa de origem e um destino começando com "/".';
      return;
    }

    if (advDraft.cpus.trim() && !(Number(advDraft.cpus) > 0)) {
      advError.value = 'CPUs deve ser um número positivo.';
      return;
    }

    if (
      advDraft.memoryMb.trim() &&
      !(/^\d+$/.test(advDraft.memoryMb.trim()) && Number(advDraft.memoryMb) > 0)
    ) {
      advError.value = 'Memória (MB) deve ser um inteiro positivo.';
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
        advError.value = 'O caminho do healthcheck deve começar com "/".';
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
      advError.value = (error as { message?: string }).message || 'Falha ao salvar.';
    } finally {
      savingAdv.value = false;
    }
  };

  // --- Variáveis ---------------------------------------------------------------------------------

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
      actionError.value = (error as { message?: string }).message || 'Falha ao salvar variáveis.';
    } finally {
      savingVars.value = false;
    }
  };

  // --- Token de acesso (repositório privado) -----------------------------------------------------

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
      actionError.value = (error as { message?: string }).message || 'Falha ao salvar o token.';
    } finally {
      savingToken.value = false;
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
      Projeto
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
            Parar
          </UiButton>
          <UiButton
            v-else-if="application.status === 'stopped'"
            variant="secondary"
            :loading="lifecycleBusy === 'start'"
            @click="runLifecycle('start')"
          >
            <Icon name="lucide:play" class="size-4" />
            Iniciar
          </UiButton>
          <UiButton
            v-if="application.status === 'running'"
            variant="secondary"
            :loading="lifecycleBusy === 'restart'"
            @click="runLifecycle('restart')"
          >
            <Icon name="lucide:rotate-cw" class="size-4" />
            Reiniciar
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
      Deploy em andamento — ver logs ao vivo
    </NuxtLink>

    <UiCard title="Configuração">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Configuração</h2>
          <UiButton v-if="canManage && !editingConfig" variant="secondary" @click="startEditConfig">
            Editar
          </UiButton>
        </div>
      </template>

      <dl v-if="!editingConfig" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Repositório</dt>
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
          <dt class="text-content-muted">Contexto de build</dt>
          <dd class="truncate">{{ application.git.buildContext }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Porta</dt>
          <dd>{{ application.port }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Deploy automático</dt>
          <dd>{{ application.git.autoDeploy ? 'Sim' : 'Não' }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Política de reinício</dt>
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
            label="Nome"
            :error="configForm.errors.value.name"
          />
          <UiInput
            v-model="configForm.values.repository"
            label="Repositório (GitHub)"
            placeholder="dono/repositório"
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
            label="Contexto de build"
            :error="configForm.errors.value.buildContext"
          />
          <UiInput
            v-model="configForm.values.port"
            label="Porta"
            :error="configForm.errors.value.port"
          />
          <UiSelect
            v-model="configForm.values.restartPolicy"
            label="Política de reinício"
            :options="restartOptions"
          />
        </div>

        <UiCheckbox v-model="configForm.values.autoDeploy" label="Deploy automático a cada push" />

        <p class="text-xs text-content-muted">As mudanças valem a partir do próximo deploy.</p>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="editingConfig = false">Cancelar</UiButton>
          <UiButton type="submit" :loading="configForm.submitting.value">Salvar</UiButton>
        </div>
      </form>
    </UiCard>

    <!-- Network -->
    <UiCard v-if="canManage" title="Network">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Network</h2>
          <UiButton v-if="!editingPorts" variant="secondary" @click="startEditPorts"
            >Editar</UiButton
          >
        </div>
      </template>

      <p class="mb-4 text-sm text-content-muted">
        Porta exposta ao proxy: <span class="font-mono text-content">{{ application.port }}</span> —
        o proxy alcança o container pelo nome; domínios apontam para ela (edite em Configuração).
      </p>

      <div class="border-t border-surface-border pt-4">
        <p class="mb-2 text-sm font-medium">Mapeamento de portas (host → container)</p>

        <template v-if="!editingPorts">
          <p v-if="!application.portMappings.length" class="text-sm text-content-muted">
            Nenhum mapeamento. Publique uma porta no host para expor um serviço sem passar pelo
            proxy.
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
              <UiInput v-model="mapping.hostPort" placeholder="Host (ex.: 8080)" />
            </div>
            <span class="text-content-muted">→</span>
            <div class="flex-1">
              <UiInput v-model="mapping.containerPort" placeholder="Container (ex.: 3000)" />
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
              Adicionar
            </UiButton>
            <div class="flex gap-2">
              <UiButton variant="ghost" @click="editingPorts = false">Cancelar</UiButton>
              <UiButton :loading="savingPorts" @click="savePorts">Salvar</UiButton>
            </div>
          </div>

          <p class="text-xs text-content-muted">As mudanças valem a partir do próximo deploy.</p>
        </div>
      </div>
    </UiCard>

    <!-- Advanced -->
    <UiCard v-if="canManage" title="Advanced">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Advanced</h2>
          <UiButton v-if="!editingAdv" variant="secondary" @click="startEditAdv">Editar</UiButton>
        </div>
      </template>

      <!-- Leitura -->
      <dl v-if="!editingAdv" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="flex justify-between gap-2 sm:col-span-2">
          <dt class="text-content-muted">Volumes</dt>
          <dd class="text-right">
            <span v-if="!application.volumes.length" class="text-content-muted">Nenhum</span>
            <ul v-else class="font-mono text-xs">
              <li v-for="(volume, index) in application.volumes" :key="index">
                {{ volume.source }}:{{ volume.target }}{{ volume.readOnly ? ' (ro)' : '' }}
              </li>
            </ul>
          </dd>
        </div>
        <div class="flex justify-between gap-2 sm:col-span-2">
          <dt class="text-content-muted">Networks extras</dt>
          <dd class="font-mono text-xs">
            {{ application.networks.length ? application.networks.join(', ') : '—' }}
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Healthcheck</dt>
          <dd class="text-right">
            <span v-if="!application.healthcheck">Desativado</span>
            <span v-else class="font-mono text-xs">
              {{ application.healthcheck.path }} · {{ application.healthcheck.intervalSeconds }}s /
              {{ application.healthcheck.timeoutSeconds }}s ×{{ application.healthcheck.retries }}
            </span>
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-content-muted">Recursos</dt>
          <dd>
            <span v-if="!application.resources?.cpus && !application.resources?.memoryMb">
              Sem limites
            </span>
            <span v-else class="font-mono text-xs">
              {{ application.resources?.cpus ? application.resources.cpus + ' CPU' : '' }}
              {{ application.resources?.memoryMb ? application.resources.memoryMb + ' MB' : '' }}
            </span>
          </dd>
        </div>
      </dl>

      <!-- Edição -->
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
                <UiInput v-model="volume.source" placeholder="origem (volume ou caminho no host)" />
              </div>
              <span class="text-content-muted">:</span>
              <div class="flex-1">
                <UiInput v-model="volume.target" placeholder="/caminho/no/container" />
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
              Adicionar volume
            </UiButton>
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <p class="mb-2 text-sm font-medium">Networks extras</p>
          <div class="flex flex-col gap-2">
            <div
              v-for="(_, index) in advDraft.networks"
              :key="index"
              class="flex items-center gap-2"
            >
              <div class="flex-1">
                <UiInput v-model="advDraft.networks[index]" placeholder="nome-da-rede-docker" />
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
              Adicionar network
            </UiButton>
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <UiCheckbox v-model="advDraft.healthcheckEnabled" label="Ativar healthcheck" />
          <div v-if="advDraft.healthcheckEnabled" class="mt-3 grid gap-4 sm:grid-cols-2">
            <UiInput v-model="advDraft.hcPath" label="Caminho" placeholder="/health" />
            <UiInput v-model="advDraft.hcInterval" label="Intervalo (s)" />
            <UiInput v-model="advDraft.hcTimeout" label="Timeout (s)" />
            <UiInput v-model="advDraft.hcRetries" label="Tentativas" />
            <UiInput v-model="advDraft.hcStartPeriod" label="Período inicial (s, opcional)" />
          </div>
        </div>

        <div class="border-t border-surface-border pt-4">
          <p class="mb-2 text-sm font-medium">Recursos (deixe vazio para sem limite)</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput v-model="advDraft.cpus" label="CPUs" placeholder="ex.: 0.5" />
            <UiInput v-model="advDraft.memoryMb" label="Memória (MB)" placeholder="ex.: 512" />
          </div>
        </div>

        <p class="text-xs text-content-muted">As mudanças valem a partir do próximo deploy.</p>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="editingAdv = false">Cancelar</UiButton>
          <UiButton :loading="savingAdv" @click="saveAdv">Salvar</UiButton>
        </div>
      </div>
    </UiCard>

    <!-- Token de acesso (repositório privado) -->
    <UiCard v-if="canManage" title="Token de acesso">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Token de acesso</h2>
          <UiButton v-if="!editingToken" variant="secondary" @click="startEditToken">
            {{ application.git.hasToken ? 'Trocar' : 'Definir' }}
          </UiButton>
        </div>
      </template>

      <template v-if="!editingToken">
        <div class="flex items-center gap-2 text-sm">
          <UiBadge :variant="application.git.hasToken ? 'success' : 'neutral'">
            {{ application.git.hasToken ? 'Configurado' : 'Não configurado' }}
          </UiBadge>
          <span class="text-content-muted">
            {{
              application.git.hasToken
                ? 'A plataforma clona o repositório privado com este token.'
                : 'Necessário apenas para repositórios privados (GitHub).'
            }}
          </span>
          <button
            v-if="application.git.hasToken"
            type="button"
            class="ml-auto rounded-lg px-2 py-1 text-xs text-content-muted transition-colors hover:text-danger"
            :disabled="savingToken"
            @click="saveToken(null)"
          >
            Remover
          </button>
        </div>
      </template>

      <div v-else class="flex flex-col gap-3">
        <UiInput
          v-model="tokenDraft"
          type="password"
          placeholder="Personal Access Token do GitHub"
          hint="Escopo de leitura do repositório. Guardado cifrado; nunca exibido de volta."
        />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="editingToken = false">Cancelar</UiButton>
          <UiButton :loading="savingToken" :disabled="!tokenDraft" @click="saveToken(tokenDraft)">
            Salvar
          </UiButton>
        </div>
      </div>
    </UiCard>

    <!-- Variáveis de ambiente -->
    <UiCard v-if="canManage" title="Variáveis de ambiente">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Variáveis de ambiente</h2>
          <UiButton v-if="!editingVars" variant="secondary" @click="startEditVars">Editar</UiButton>
        </div>
      </template>

      <template v-if="!editingVars">
        <p v-if="!data?.variables.length" class="text-sm text-content-muted">
          Nenhuma variável definida.
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
            <UiInput v-model="variable.key" placeholder="CHAVE" />
          </div>
          <div class="flex-1">
            <UiInput v-model="variable.value" placeholder="valor" />
          </div>
          <UiCheckbox v-model="variable.secret" label="secreta" />
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
            Adicionar
          </UiButton>
          <div class="flex gap-2">
            <UiButton variant="ghost" @click="editingVars = false">Cancelar</UiButton>
            <UiButton :loading="savingVars" @click="saveVars">Salvar</UiButton>
          </div>
        </div>
      </div>
    </UiCard>

    <!-- Histórico de deploys -->
    <UiCard title="Deploys">
      <p v-if="!deploymentList.length" class="text-sm text-content-muted">Nenhum deploy ainda.</p>

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
            <Icon name="lucide:chevron-right" class="size-4 text-content-muted" />
          </NuxtLink>
        </li>
      </ul>
    </UiCard>
  </section>

  <section v-else class="mx-auto max-w-4xl py-16 text-center text-sm text-content-muted">
    Carregando…
  </section>
</template>
