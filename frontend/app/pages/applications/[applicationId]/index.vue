<script setup lang="ts">
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

  // --- Deploy ------------------------------------------------------------------------------------

  const deploying = ref(false);

  const triggerDeploy = async () => {
    actionError.value = '';
    deploying.value = true;

    try {
      await applications.deploy(applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Falha ao disparar o deploy.';
    } finally {
      deploying.value = false;
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
        <UiButton v-if="canManage" :loading="deploying" @click="triggerDeploy">
          <Icon name="lucide:rocket" class="size-4" />
          Deploy
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>
    <UiAlert v-if="application.lastError" variant="error">{{ application.lastError }}</UiAlert>

    <UiCard title="Configuração">
      <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
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
        <li
          v-for="deployment in deploymentList"
          :key="deployment.id"
          class="flex flex-wrap items-center gap-3 py-3"
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
              :key="step.name"
              :title="`${step.name}: ${step.status}`"
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              :class="{
                'bg-success/15 text-success': step.status === 'ok',
                'bg-danger/15 text-danger': step.status === 'failed',
                'bg-primary/15 text-primary': step.status === 'running',
                'bg-surface text-content-muted':
                  step.status === 'queued' || step.status === 'skipped',
              }"
            >
              {{ step.name }}
            </span>
          </div>
        </li>
      </ul>
    </UiCard>
  </section>

  <section v-else class="mx-auto max-w-4xl py-16 text-center text-sm text-content-muted">
    Carregando…
  </section>
</template>
